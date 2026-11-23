import assert from "node:assert/strict";
import { CloudflareAdapter } from "../src/lib/integrations/cloudflare/adapter";
import { configureDomainHttps } from "../src/lib/services/https";
import { prisma } from "../src/lib/db";
import { encryptJson } from "../src/lib/crypto";

process.env.ENCRYPTION_KEY = "12".repeat(32);
let ssl = "strict", redirect = "off", denied = false, ignorePatch = false;
const requests: { path: string; method: string; body?: unknown }[] = [];
const records = [{ id: "root", type: "A", name: "example.test", content: "192.0.2.1", proxied: true }];
const originalFetch = globalThis.fetch;
const restore: Array<() => void> = [];
function stub(target: object, key: string, replacement: unknown) {
  const previous = Reflect.get(target, key); Reflect.set(target, key, replacement);
  restore.push(() => { Reflect.set(target, key, previous); });
}
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)), method = init?.method ?? "GET";
  assert.equal(url.hostname, "api.cloudflare.com");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ path: url.pathname, method, body });
  if (url.pathname.endsWith("/dns_records") && method === "GET") return Response.json({ success: true, result: records });
  if (denied) return Response.json({ success: false, errors: [{ code: 9109, message: "Unauthorized to access requested resource" }] }, { status: 403 });
  if (url.pathname.endsWith("/settings/ssl") && method === "GET") return Response.json({ success: true, result: { value: ssl } });
  assert(url.pathname.endsWith("/settings/always_use_https"));
  if (method === "PATCH") { assert.deepEqual(body, { value: "on" }); if (!ignorePatch) redirect = "on"; }
  else assert.equal(method, "GET");
  return Response.json({ success: true, result: { value: redirect } });
};

async function main() {
  const adapter = new CloudflareAdapter({ apiToken: "test", accountId: "account" });
  assert.deepEqual(await adapter.enableHttps("zone"), { changed: true });
  assert.equal(ssl, "strict");
  const writes = requests.filter(r => r.method === "PATCH").length;
  assert.deepEqual(await adapter.enableHttps("zone"), { changed: false });
  assert.equal(requests.filter(r => r.method === "PATCH").length, writes, "Already configured zones are not rewritten");
  for (ssl of ["off", "unexpected"]) await assert.rejects(adapter.enableHttps("zone"), /disabled or unavailable/);
  assert.equal(requests.filter(r => r.method === "PATCH").length, writes, "SSL mode is never downgraded or silently enabled");
  ssl = "full"; redirect = "off"; ignorePatch = true;
  await assert.rejects(adapter.enableHttps("zone"), /did not confirm/);
  ignorePatch = false; denied = true;
  await assert.rejects(adapter.enableHttps("zone"), /Zone Settings → Edit/);
  denied = false;

  const domain = { id: "domain", domain: "example.test", httpsConfiguredAt: null as Date | null, httpsError: null as string | null,
    cloudflare: { zoneId: "zone", accountId: "account" }, dnsRecords: records };
  const updates: Record<string, unknown>[] = [];
  const logs: { action: string }[] = [];
  stub(prisma.domain, "findUnique", async () => domain);
  stub(prisma.domain, "update", async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); Object.assign(domain, data); return domain; });
  stub(prisma.cloudflareAccount, "findUnique", async () => ({ enabled: true, credentialsEncrypted: encryptJson({ apiToken: "test", accountId: "account" }) }));
  stub(prisma.activityLog, "create", async ({ data }: { data: { action: string } }) => { logs.push(data); return data; });
  assert.equal((await configureDomainHttps("domain")).ok, true);
  assert(domain.httpsConfiguredAt);
  denied = true;
  assert.equal((await configureDomainHttps("domain")).ok, false);
  assert.match(domain.httpsError!, /Zone Settings/);
  const failures = logs.filter(l => l.action === "https.failed").length;
  await configureDomainHttps("domain");
  assert.equal(logs.filter(l => l.action === "https.failed").length, failures, "Unchanged failures are not logged repeatedly");
  denied = false;
  assert.equal((await configureDomainHttps("domain")).ok, true);
  assert.equal(domain.httpsError, null);
  const before = requests.length;
  domain.dnsRecords.push({ id: "www", type: "A", name: "www.example.test", content: "192.0.2.1", proxied: false });
  assert.equal((await configureDomainHttps("domain")).ok, false);
  assert.match(domain.httpsError!, /DNS-only/);
  assert.equal(requests.length, before + 1, "Only live DNS is read for DNS-only sites; no redirect setting is changed");
  assert(updates.every(data => Object.keys(data).every(k => ["httpsConfiguredAt", "httpsError"].includes(k))), "HTTPS errors must not change purchase or DNS status");
  assert(requests.every(r => r.method === "GET" || r.path.endsWith("/always_use_https")), "DNS records and origin SSL settings are preserved");
  console.log("PASS: HTTPS defaults, idempotency, permission errors, retries, SSL-mode preservation, provider confirmation, DNS-only handling and independent purchase status. All HTTP/database calls mocked.");
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { globalThis.fetch = originalFetch; restore.forEach(f => f()); await prisma.$disconnect(); });
