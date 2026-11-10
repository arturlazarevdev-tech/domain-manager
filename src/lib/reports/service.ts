import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { GoogleSheets, type ServiceAccount } from "./google-sheets";
import { localDay, moneyTotals, previousWeek } from "./week";

export async function previewReport(now = new Date()) {
  const week = previousWeek(now);
  const domains = await prisma.domain.findMany({
    where: { OR: [
      { registeredAt: { gte: week.start, lt: week.end } },
      { registeredAt: null, status: { in: ["purchased", "active"] }, createdAt: { gte: week.start, lt: week.end } },
    ] },
    orderBy: [{ registeredAt: "asc" }, { createdAt: "asc" }, { domain: "asc" }],
    select: { domain: true, registeredAt: true, createdAt: true, purchasePrice: true, currency: true,
      registrar: { select: { name: true } }, buyer: { select: { name: true } }, buyerGroup: { select: { name: true } },
      hestia: { select: { server: { select: { name: true } } } }, keitaro: { select: { server: { select: { name: true } } } },
      cloudflare: { select: { account: { select: { name: true } } } } },
  });
  const rows = domains.map(d => [localDay(d.registeredAt ?? d.createdAt), Number(d.purchasePrice), d.domain, d.registrar.name, d.currency, d.buyer?.name ?? "", d.buyerGroup?.name ?? "", d.hestia?.server.name ?? d.keitaro?.server.name ?? "", d.cloudflare?.account.name ?? ""]);
  return { week, rows, count: rows.length, totals: moneyTotals(rows) };
}
export async function sendWeeklyReport(scheduled = false) {
  const settings = await prisma.googleSheetsReportSettings.findUnique({ where: { id: "default" } });
  if (scheduled && !settings?.enabled) return { skipped: true };
  if (!settings?.credentialsEncrypted) throw new AppError({ message: "Connect a Google service account first" });
  await prisma.googleSheetsReportSettings.update({ where: { id: "default" }, data: { lastAttemptAt: new Date() } });
  try {
    const { week, rows } = await previewReport();
    const client = new GoogleSheets(decryptJson<ServiceAccount>(settings.credentialsEncrypted));
    const result = await client.publish(settings.spreadsheetId, week.startDay, week.lastDay, rows);
    await prisma.googleSheetsReportSettings.update({ where: { id: "default" }, data: { lastSuccessAt: new Date(), lastReportWeek: week.startDay, lastSheetId: result.sheetId, lastDomainCount: result.count, lastError: null } });
    return { ...result, week: week.startDay, url: `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit#gid=${result.sheetId}` };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Report delivery failed. Check Google access and try again.";
    await prisma.googleSheetsReportSettings.update({ where: { id: "default" }, data: { lastError: message } });
    throw new AppError({ message, status: 502 });
  }
}
