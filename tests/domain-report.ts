import assert from "node:assert/strict";
import { domainReportCsv, flattenReportGroups, groupDomainReport, matchesPurchaseDates, purchaseDay, reportTotals, type ReportDomain } from "../src/lib/domain-report";

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

const groupedRows: ReportDomain[] = [
  { ...base, domain: 'one.digital', registrar: { id: 'r1', name: 'Dynadot' }, buyer: { id: 'b1', name: 'Alex' }, buyerGroup: { id: 'g1', name: 'KIT' }, purchasePrice: 0.1 },
  { ...base, domain: 'two.digital', registrar: { id: 'r2', name: 'Openprovider' }, buyer: { id: 'b1', name: 'Alex' }, buyerGroup: { id: 'g1', name: 'KIT' }, purchasePrice: 0.2 },
  { ...base, domain: 'direct.digital', registrar: { id: 'r1', name: 'Dynadot' }, buyer: null, buyerGroup: { id: 'g1', name: 'KIT' }, purchasePrice: 2 },
  { ...base, domain: 'other.digital', registrar: { id: 'r1', name: 'Dynadot' }, buyer: { id: 'b2', name: 'Alex' }, buyerGroup: { id: 'g2', name: 'Other' }, purchasePrice: 5, currency: 'EUR' },
  { ...base, domain: 'unassigned.digital', registrar: { id: 'r2', name: 'Openprovider' }, buyer: null, buyerGroup: null, purchasePrice: 1 },
];
const byBuyer = groupDomainReport(groupedRows, ['buyer']);
assert.equal(byBuyer.filter(group => group.label === 'Alex').length, 2, 'Same display names with different IDs stay separate');
assert.deepEqual(byBuyer.find(group => group.domains.some(row => row.buyer?.id === 'b1'))?.totals, [{ currency: 'USD', amount: 0.3 }], 'Buyer total spans registrars');
assert(byBuyer.some(group => group.label === 'Group needs'));
assert(byBuyer.some(group => group.label === 'Unassigned'));
const byTeam = groupDomainReport(groupedRows, ['buyerGroup']);
assert.deepEqual(byTeam.find(group => group.label === 'KIT')?.totals, [{ currency: 'USD', amount: 2.3 }], 'Group spend includes buyers and purchases for group needs');
const hierarchy = groupDomainReport(groupedRows, ['registrar', 'buyerGroup', 'buyer']);
const allGroups = flattenReportGroups(hierarchy);
assert.equal(hierarchy.reduce((sum, group) => sum + group.domains.length, 0), 5);
assert.equal(allGroups.filter(group => !group.children.length).flatMap(group => group.domains).length, 5, 'Every domain occurs in one leaf');
assert.deepEqual(hierarchy.find(group => group.label === 'Dynadot')?.totals, [{ currency: 'USD', amount: 2.1 }, { currency: 'EUR', amount: 5 }], 'Currencies are never combined');
assert.deepEqual(groupDomainReport([], ['buyer']), []);
assert.deepEqual(groupDomainReport(groupedRows, []), []);
assert.deepEqual(groupDomainReport(groupedRows, ['buyer', 'buyer']), byBuyer);
const groupedCsv = domainReportCsv(groupedRows, ['registrar', 'buyerGroup', 'buyer']);
assert(groupedCsv.includes('"Grouped spending report"'));
assert(groupedCsv.includes('"Buyer group","KIT","Registrar: Dynadot","2","2.10","USD"'));
assert.equal((groupedCsv.match(/"one.digital"/g) ?? []).length, 1, 'CSV detail rows are not repeated for parent totals');
assert(domainReportCsv(rows, ['buyer']).includes('"\' =1+1"'), 'Grouped summary cells retain spreadsheet formula protection');
console.log('PASS: grouped registrar, buyer group and buyer totals, direct group purchases, same-name IDs, nesting, empty results, currencies and grouped CSV.');
