import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { encryptJson } from "../src/lib/crypto";
import { createKeitaroIpJob, processKeitaroIpJob, type IpUpdatePayload } from "../src/lib/services/keitaro-ip";

// No database or remote integrations are used by this orchestration check.
const restore: Array<() => void> = [];
function mock(target: object, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restore.push(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
}
const originalFetch = globalThis.fetch;
const originalKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = "ab".repeat(32);
let active = false;
let exists = true;
let lockCount = 0;
let successfulUpdates = 0;
let completed = 0;
let reported: Array<{ domainId: string; ok: boolean }> = [];
let payload: IpUpdatePayload;
let serverUpdate: { ipAddress?: string; url?: string } = {};
let serverUrl = "https://203.0.113.1:443";
const oldIp = "203.0.113.1";
const targetIp = "203.0.113.2";
const rows = ["success", "missing-zone", "moved"].map(id => ({ id, domain: `${id}.example`, cloudflare: id === "missing-zone" ? null : { accountId: "cf", zoneId: "zone" }, keitaro: { serverId: id === "moved" ? "another-server" : "server" } }));
mock(prisma, "$transaction", async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
mock(prisma, "$executeRaw", async () => { lockCount++; return 1; });
mock(prisma.keitaroServer, "findUnique", async () => exists ? { id: "server", ipAddress: oldIp, url: serverUrl } : null);
mock(prisma.keitaroServer, "update", async ({ data }: { data: typeof serverUpdate }) => { serverUpdate = data; });
mock(prisma.domainKeitaro, "findMany", async () => rows.map(r => ({ domainId: r.id })));
mock(prisma.domainKeitaro, "findUnique", async () => ({ serverId: "server" }));
mock(prisma.domainKeitaro, "update", async ({ data }: { data: { serverIp: string } }) => { assert.equal(data.serverIp, targetIp); successfulUpdates++; });
mock(prisma.job, "findFirst", async () => active ? { id: "existing-job" } : null);
mock(prisma.job, "create", async ({ data }: { data: { payload: IpUpdatePayload } }) => { payload = data.payload; return { id: "job", ...data }; });
mock(prisma.job, "update", async ({ data }: { data: { progress: { completed: number }; result: { results: typeof reported } } }) => { completed = data.progress.completed; reported = [...data.result.results]; });
mock(prisma.domain, "findUnique", async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id));
mock(prisma.cloudflareAccount, "findUnique", async () => ({ credentialsEncrypted: encryptJson({ apiToken: "mock", accountId: "mock" }) }));
mock(prisma.domainDnsRecord, "deleteMany", async () => ({}));
mock(prisma.domainDnsRecord, "createMany", async () => ({}));
mock(prisma.activityLog, "create", async () => ({}));
let remoteIp = oldIp;
globalThis.fetch = (async (input, init) => {
  assert.equal(new URL(String(input)).hostname, "api.cloudflare.com");
  if (init?.method === "PATCH") { remoteIp = JSON.parse(String(init.body)).content; return Response.json({ success: true, result: {} }); }
  assert(!init?.method, "Only DNS reads and IP PATCH requests are permitted");
  return Response.json({ success: true, result: [{ id: "dns", type: "A", name: "success.example", content: remoteIp, proxied: true }] });
}) as typeof fetch;

async function main() {
  await assert.rejects(createKeitaroIpJob("server", "wrong"), /valid IPv4/);
  assert.equal(lockCount, 0);
  active = true;
  await assert.rejects(createKeitaroIpJob("server", targetIp), /already running/);
  active = false;
  exists = false;
  await assert.rejects(createKeitaroIpJob("server", targetIp), /not found/);
  exists = true;
  await createKeitaroIpJob("server", targetIp);
  assert.equal(serverUpdate.ipAddress, targetIp);
  assert.equal(new URL(serverUpdate.url!).hostname, targetIp, "Literal IP API URL follows the IP change");
  assert.deepEqual(payload.domainIds, rows.map(r => r.id));
  serverUrl = "https://tracker.example";
  await createKeitaroIpJob("server", targetIp);
  assert.equal(serverUpdate.url, serverUrl, "Stable API hostname is preserved");
  await assert.rejects(processKeitaroIpJob("job", payload), /2 of 3 domains failed/);
  assert.equal(completed, 3, "Failures do not stop later domains");
  assert.equal(successfulUpdates, 1, "Only verified domains receive new local IP metadata");
  assert.deepEqual(reported.map(r => r.ok), [true, false, false]);
  await assert.rejects(processKeitaroIpJob("job", payload), /2 of 3 domains failed/);
  assert.equal(successfulUpdates, 2, "Retry accepts already migrated DNS");
  console.log("PASS: job validation, server-scoped locking/duplicate protection, literal IP URL migration, stable hostname preservation, assignment checks, missing zones, individual results, partial failure and retry. Database and HTTP mocked.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const fn of restore.reverse()) fn();
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = originalKey;
  await prisma.$disconnect();
});
