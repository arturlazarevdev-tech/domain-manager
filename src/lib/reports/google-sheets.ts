import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { REPORT_COLUMNS, moneyTotals } from "./week";

export const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  client_email: z.email().endsWith(".gserviceaccount.com"),
  private_key: z.string().max(16000).includes("-----BEGIN PRIVATE KEY-----"),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;
const marker = "domain_manager_weekly_purchases_v1";
type Sheet = { properties: { sheetId: number; title: string }; developerMetadata?: { metadataKey: string; metadataValue: string }[] };
type Spreadsheet = { sheets?: Sheet[] };
export function reportIdentity(spreadsheetId: string, week: string, lastDay: string) {
  return { sheetId: (createHash("sha256").update(`${spreadsheetId}:${week}`).digest().readUInt32BE(0) & 0x7fffffff) || 1, title: `Покупки ${week} — ${lastDay}` };
}
export function reportRequests(sheetId: number, title: string, week: string, rows: (string | number)[][]) {
  const totals = moneyTotals(rows);
  const table = [REPORT_COLUMNS, ...rows, [], ...Object.entries(totals).map(([currency, amount]) => ["Итого", amount, "", "", currency])];
  if (!rows.length) table.push(["Покупок за эту неделю нет"]);
  return [
    { addSheet: { properties: { sheetId, title, gridProperties: { rowCount: Math.max(100, table.length + 10), columnCount: 9, frozenRowCount: 1 } } } },
    { createDeveloperMetadata: { developerMetadata: { metadataKey: marker, metadataValue: JSON.stringify({ week, count: rows.length, totals }), location: { sheetId }, visibility: "DOCUMENT" } } },
    { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: table.map(row => ({ values: row.map(value => ({ userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value } })) })), fields: "userEnteredValue" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.05, green: 0.45, blue: 0.42 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: "userEnteredFormat" } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 9 } } },
    ...(rows.length ? [{ setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: 9 } } } }] : []),
  ];
}
export class GoogleSheets {
  private token?: string;
  constructor(private credentials: ServiceAccount, private transport: typeof fetch = fetch) {}
  private async accessToken() {
    if (this.token) return this.token;
    const tokenUrl = "https://oauth2.googleapis.com/token";
    const key = await importPKCS8(this.credentials.private_key, "RS256").catch(() => { throw new AppError({ message: "Invalid Google private key" }); });
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(this.credentials.client_email).setAudience(tokenUrl).setIssuedAt().setExpirationTime("1h").sign(key);
    const response = await this.transport(tokenUrl, { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new AppError({ message: "Google authentication failed. Check the service account key.", status: 502 });
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) throw new AppError({ message: "Google returned no access token", status: 502 });
    return this.token = data.access_token;
  }
  private async request(id: string, body?: unknown): Promise<Spreadsheet> {
    const token = await this.accessToken();
    const suffix = body ? ":batchUpdate" : "?fields=sheets(properties(sheetId,title),developerMetadata(metadataKey,metadataValue))";
    const response = await this.transport(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}${suffix}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000), cache: "no-store",
    });
    if (!response.ok) throw new AppError({ message: response.status === 403 ? "Google denied access. Enable Sheets API and share the spreadsheet with the service account as Editor." : `Google Sheets request failed (${response.status}). Check the spreadsheet ID and access.`, status: 502 });
    return response.json();
  }
  async publish(id: string, week: string, lastDay: string, rows: (string | number)[][]) {
    const { sheetId, title } = reportIdentity(id, week, lastDay);
    const find = (document: Spreadsheet) => {
      const sheet = document.sheets?.find(s => s.properties.sheetId === sheetId || s.properties.title === title);
      if (!sheet) return null;
      const value = sheet.developerMetadata?.find(m => m.metadataKey === marker)?.metadataValue;
      if (!value) throw new AppError({ message: "A worksheet with this report name already exists and is not managed by this application." });
      const data = JSON.parse(value) as { week: string; count: number; totals: Record<string, number> };
      if (data.week !== week) throw new AppError({ message: "Report worksheet conflict" });
      return { sheetId: sheet.properties.sheetId, count: data.count, totals: data.totals, reused: true };
    };
    const existing = find(await this.request(id));
    if (existing) return existing;
    try {
      await this.request(id, { requests: reportRequests(sheetId, title, week, rows) });
    } catch (error) {
      // A timeout or a concurrent run may have committed the complete atomic batch.
      const recovered = await this.request(id).then(find).catch(() => null);
      if (recovered) return recovered;
      throw error;
    }
    return { sheetId, count: rows.length, totals: moneyTotals(rows), reused: false };
  }
}
