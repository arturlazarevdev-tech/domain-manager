import assert from "node:assert/strict";
import { domainReportCsv, matchesPurchaseDates, purchaseDay, reportTotals, type ReportDomain } from "../src/lib/domain-report";

process.env.TZ = "Europe/Kyiv";
assert.equal(purchaseDay("2026-10-12T21:00:00Z"), "2026-10-13");
assert(matchesPurchaseDates("2026-10-12T21:00:00Z", "2026-10-13", "2026-10-13"));
assert(matchesPurchaseDates("2026-10-13T20:59:59.999Z", "2026-10-13", "2026-10-13"));
assert(!matchesPurchaseDates("2026-10-13T21:00:00Z", "2026-10-13", "2026-10-13"));
assert(matchesPurchaseDates("2026-10-13T12:00:00Z", "2026-10-12", ""));
assert(matchesPurchaseDates("2026-10-13T12:00:00Z", "", "2026-10-14"));
assert(!matchesPurchaseDates("2026-10-13T12:00:00Z", "2026-10-14", "2026-10-12"));
assert(!matchesPurchaseDates(undefined, "2026-10-12", ""));
assert(!matchesPurchaseDates("invalid", "", "2026-10-14"));
assert(matchesPurchaseDates(undefined, "", ""));
const base: ReportDomain = {
  domain: "example.com", purchasedAt: "2026-10-12T21:00:00Z", purchasePrice: 0.1, currency: "USD", status: "purchased",
  registrar: { name: "Openprovider" }, buyer: { name: 'Max, "Smith"\nBuyer' }, buyerGroup: { name: "KIT TEAM" },
  cloudflare: { status: "pending", account: { name: "Cloudflare" } }, dns: { ip: null }, server: null, group: null,
};
const rows = [base, { ...base, domain: "direct.xyz", buyer: null, purchasePrice: 0.2 }, { ...base, domain: "eur.xyz", purchasePrice: 5, currency: "EUR", buyer: { name: " =1+1" } }];
assert.deepEqual(reportTotals(rows), [{ currency: "USD", amount: 0.3 }, { currency: "EUR", amount: 5 }]);
const csv = domainReportCsv(rows);
assert(csv.startsWith('\uFEFF"Domain"'));
assert(csv.includes('"Max, ""Smith""\nBuyer"'));
assert(csv.includes('"\' =1+1"'));
assert(csv.includes('"Group needs"'));
assert(csv.includes('"2026-10-13","2026-10-12T21:00:00.000Z"'));
assert(csv.includes('"0.30","USD"'));
assert(csv.includes('"5.00","EUR"'));
assert(csv.includes('"Total: 2 domains"'));
assert(!domainReportCsv([base]).includes("direct.xyz"));
assert(!domainReportCsv([]).includes("Total:"));
console.log("PASS: inclusive local date boundaries, open ranges, invalid dates, currency totals, filtered report rows, CSV escaping, UTF-8 BOM, spreadsheet formula protection, group purchases and UTC timestamps.");
