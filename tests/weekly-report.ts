import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GoogleSheets, reportRequests, reportIdentity } from "../src/lib/reports/google-sheets";
import { previousWeek, localDay, moneyTotals } from "../src/lib/reports/week";

async function main() {
  const winter = previousWeek(new Date("2026-11-16T07:00:00Z"));
  assert.equal(winter.start.toISOString(), "2026-11-08T22:00:00.000Z");
  assert.equal(winter.end.toISOString(), "2026-11-15T22:00:00.000Z");
  const spring = previousWeek(new Date("2026-03-30T06:00:00Z"));
  assert.equal((spring.end.getTime() - spring.start.getTime()) / 3600000, 167);
  const autumn = previousWeek(new Date("2026-10-26T07:00:00Z"));
  assert.equal((autumn.end.getTime() - autumn.start.getTime()) / 3600000, 169);
  assert.equal(localDay(new Date("2026-11-08T22:30:00Z")), "2026-11-09");
  // Sunday night UTC is already Monday in Kyiv.
  assert.equal(previousWeek(new Date("2026-11-15T22:30:00Z")).startDay, "2026-11-09");
  const rows = [["2026-11-09", 0.1, "=HYPERLINK(\"bad\")", "Provider", "USD"], ["2026-11-10", 0.2, "a.com", "Provider", "USD"], ["2026-11-11", 12.17, "b.com", "Provider", "EUR"]];
  assert.deepEqual(moneyTotals(rows), { EUR: 12.17, USD: 0.3 });
  const requests = reportRequests(123, "Test", "2026-11-09", rows);
  const cells = requests[2].updateCells!;
  assert.equal(cells.rows[1].values[2].userEnteredValue.stringValue, '=HYPERLINK("bad")');
  assert.equal(cells.rows[1].values[1].userEnteredValue.numberValue, 0.1);
  assert.equal(requests.at(-1)?.setBasicFilter?.filter.range.endRowIndex, 4);
  assert(!reportRequests(123, "Test", "2026-11-09", []).some(r => r.setBasicFilter));
  const private_key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  let saved: unknown[] = [], posts = 0, failAfterCommit = false;
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com")) return Response.json({ access_token: "fake" });
    if (init?.method === "POST") {
      posts++;
      const requests = JSON.parse(String(init.body)).requests;
      saved = [{ properties: requests[0].addSheet.properties, developerMetadata: [requests[1].createDeveloperMetadata.developerMetadata] }];
      if (failAfterCommit) throw new Error("network response lost");
      return Response.json({});
    }
    return Response.json({ sheets: saved });
  }) as typeof fetch;
  const client = new GoogleSheets({ type: "service_account", client_email: "test@example.iam.gserviceaccount.com", private_key }, transport);
  const first = await client.publish("spreadsheet", "2026-11-09", "2026-11-15", rows);
  assert.equal(first.reused, false);
  const duplicate = await client.publish("spreadsheet", "2026-11-09", "2026-11-15", []);
  assert.equal(duplicate.reused, true); assert.equal(duplicate.count, 3); assert.equal(posts, 1);
  saved = []; failAfterCommit = true;
  assert.equal((await client.publish("spreadsheet", "2026-11-09", "2026-11-15", rows)).reused, true);
  saved = [{ properties: reportIdentity("spreadsheet", "2026-11-09", "2026-11-15") }];
  await assert.rejects(client.publish("spreadsheet", "2026-11-09", "2026-11-15", rows), /not managed/);
  assert.equal(posts, 2, "foreign worksheets never overwritten");
  console.log("PASS: Kyiv week boundaries and DST, currency totals, literal cells, report formatting, duplicate prevention, ambiguous network recovery, foreign-sheet protection.");
}
void main();
