import assert from "node:assert/strict";
import { refreshDomainSelection } from "../src/lib/services/bulk-refresh";
import { prisma } from "../src/lib/db";
import { encryptJson } from "../src/lib/crypto";

process.env.ENCRYPTION_KEY = "12".repeat(32);
const restore: Array<() => void> = [];
function stub(target: object, key: string, value: unknown) {
  const previous = Reflect.get(target, key);
  Reflect.set(target, key, value);
  restore.push(() => { Reflect.set(target, key, previous); });
}
const domains = ["a", "b", "without-cf", "display-only"].map(id => ({ id, domain: `${id}.example`, cloudflare: id === "without-cf" ? null : { id: `cf-${id}`, account: { accountId: id === "display-only" ? "" : "account" } } }));
const links = domains.filter(d => d.cloudflare).map(d => ({ id: `cf-${d.id}`, domainId: d.id, domain: d, accountId: "account", zoneId: `zone-${d.id}` }));
const reads: string[] = [], snapshots: string[] = [];
let failA = false;
stub(prisma.domain, "findMany", async (args: { where: { id: { in: string[] } } }) => domains.filter(d => args.where.id.in.includes(d.id)));
stub(prisma.domainCloudflare, "findMany", async (args: { where: { OR?: Array<{ domainId?: string }>; account?: { accountId: { not: string } } } }) => args.where.OR ? links.filter(l => args.where.OR!.some(condition => condition.domainId === l.domainId)) : links.filter(l => !args.where.account || l.domain.cloudflare?.account.accountId !== args.where.account.accountId.not));
stub(prisma.cloudflareAccount, "findUnique", async () => ({ enabled: true, credentialsEncrypted: encryptJson({ apiToken: "test", accountId: "account" }) }));
stub(prisma.domain, "update", async () => ({}));
stub(prisma.activityLog, "create", async () => ({}));
stub(prisma, "$transaction", async (callback: (tx: object) => Promise<void>) => callback({
  domainCloudflare: { update: async () => ({}) },
  domainDnsRecord: {
    deleteMany: async (args: { where: { domainId: string } }) => { snapshots.push(args.where.domainId); },
    createMany: async () => ({}),
  },
}));
stub(globalThis, "fetch", async (input: string, init?: RequestInit) => {
  assert.equal(init?.method ?? "GET", "GET", "Refresh must never write to Cloudflare");
  const url = new URL(String(input));
  assert.equal(url.hostname, "api.cloudflare.com");
  reads.push(url.pathname);
  const id = url.pathname.includes("zone-a") ? "a" : "b";
  if (id === "a" && failA) throw new Error("Provider unavailable");
  return Response.json({ success: true, result: url.pathname.endsWith("/dns_records") ? [{ id: `record-${id}`, type: "A", name: `${id}.example`, content: "192.0.2.1", proxied: true }] : { id: `zone-${id}`, name: `${id}.example`, status: "active", name_servers: ["a.ns.example", "b.ns.example"] } });
});

async function main() {
  for (const body of [{}, { domainIds: [] }, { all: false }, { all: true, domainIds: [] }, { domainIds: [""] }]) await assert.rejects(refreshDomainSelection(body));
  assert.equal(reads.length, 0, "Invalid or empty selection must not trigger a global refresh");
  await assert.rejects(refreshDomainSelection({ domainIds: ["a", "missing"] }), /no longer exist/);
  assert.equal(reads.length, 0, "Validate the entire selection before contacting providers");

  const result = await refreshDomainSelection({ domainIds: ["a", "a", "without-cf"] });
  assert.deepEqual(result.results?.map(r => ({ id: r.id, ok: r.ok, skipped: !!r.skipped })), [{ id: "a", ok: true, skipped: false }, { id: "without-cf", ok: false, skipped: true }]);
  assert.deepEqual(snapshots, ["a"], "Only the selected domain's cached DNS may change; duplicate IDs refresh once");
  assert(reads.every(path => path.includes("zone-a")), "Unselected zones are never contacted");
  const beforeDisplayOnly = reads.length;
  const displayOnly = await refreshDomainSelection({ domainIds: ["display-only"] });
  assert.equal(displayOnly.results?.[0].skipped, true);
  assert.equal(reads.length, beforeDisplayOnly, "Display-only account records must never contact Cloudflare");

  failA = true;
  const partial = await refreshDomainSelection({ domainIds: ["a", "b"] });
  assert.equal(partial.ok, false);
  assert.equal(partial.results?.find(r => r.id === "a")?.ok, false);
  assert.equal(partial.results?.find(r => r.id === "b")?.ok, true, "One failed domain must not prevent the remaining selection from refreshing");
  failA = false;
  reads.length = 0;
  await refreshDomainSelection({ all: true });
  assert(reads.some(path => path.includes("zone-a")) && reads.some(path => path.includes("zone-b")), "Only an explicit all request refreshes all zones");
  console.log("PASS: selection isolation, duplicate IDs, empty/ambiguous scope rejection, missing domains, skipped domains, partial failures and explicit refresh-all. All database/provider calls mocked.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { restore.reverse().forEach(f => f()); await prisma.$disconnect(); });
