import assert from "node:assert/strict";
import { CloudflareAdapter } from "../src/lib/integrations/cloudflare/adapter";
import { updateKeitaroDns, validateServerIp } from "../src/lib/services/keitaro-dns";

const originalFetch = globalThis.fetch;
const root = "migration.example";
let failRecord = "";
let malformed = false;
let writes = 0;
let records = [
  { id: "apex", type: "A", name: root, content: "203.0.113.1", proxied: true, ttl: 3600, comment: "keep" },
  { id: "apex2", type: "A", name: root, content: "203.0.113.2", proxied: false, ttl: 120, comment: "second IP" },
  { id: "www", type: "A", name: `www.${root}`, content: "203.0.113.1", proxied: false, ttl: 600, comment: "keep" },
  { id: "sub", type: "A", name: `other.${root}`, content: "203.0.113.1", proxied: false, ttl: 600, comment: "keep" },
  { id: "txt", type: "TXT", name: root, content: "verification", proxied: false, ttl: 600, comment: "keep" },
  { id: "mx", type: "MX", name: root, content: "mail.example", proxied: false, ttl: 600, comment: "keep" },
];
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.cloudflare.com");
  assert(init?.signal, "Provider calls must have a timeout");
  if (!init?.method || init.method === "GET") {
    const page = Number(url.searchParams.get("page") ?? 1);
    return Response.json({ success: true, result: malformed ? {} : records.slice((page - 1) * 100, page * 100), result_info: { total_pages: Math.ceil(records.length / 100) } });
  }
  assert.equal(init.method, "PATCH", "IP migration must not overwrite or delete records");
  const record = records.find(r => url.pathname.endsWith(`/${r.id}`));
  assert(record);
  const body = JSON.parse(String(init.body));
  assert.deepEqual(Object.keys(body), ["content"], "Preserve all other provider fields");
  if (record.id === failRecord) return Response.json({ success: false, errors: [{ message: "Token cannot edit this record" }] }, { status: 403 });
  Object.assign(record, body);
  writes++;
  return Response.json({ success: true, result: record });
}) as typeof fetch;

async function main() {
  const adapter = new CloudflareAdapter({ apiToken: "mock-only", accountId: "mock" });
  assert.throws(() => validateServerIp("bad"));
  assert.throws(() => validateServerIp("::1"));
  failRecord = "www";
  await assert.rejects(updateKeitaroDns(adapter, "zone", root, "203.0.113.99"), /Token cannot edit/);
  assert.equal(writes, 2, "Partial success is retryable");
  failRecord = "";
  await updateKeitaroDns(adapter, "zone", root, "203.0.113.99");
  assert.equal(writes, 3, "Retry skips already updated records");
  await updateKeitaroDns(adapter, "zone", root, "203.0.113.99");
  assert.equal(writes, 3, "Repeat is idempotent");
  assert.equal(records[0].ttl, 3600);
  assert.equal(records[0].proxied, true);
  assert.equal(records[1].proxied, false);
  assert.equal(records[0].comment, "keep");
  assert.equal(records[3].content, "203.0.113.1");
  assert.equal(records[4].content, "verification");
  assert.equal(records[5].content, "mail.example");
  records[2] = { ...records[2], type: "CNAME", content: root + "." };
  await updateKeitaroDns(adapter, "zone", root, "203.0.113.98");
  assert.equal(records[2].content, root + ".", "Root aliases remain intact");
  records[2].content = "unrelated.example";
  const before = writes;
  await assert.rejects(updateKeitaroDns(adapter, "zone", root, "203.0.113.97"), /another hostname/);
  assert.equal(writes, before, "Validate conflicts before any DNS writes");
  records[2] = { ...records[2], type: "AAAA", content: "::1" };
  await assert.rejects(updateKeitaroDns(adapter, "zone", root, "203.0.113.97"), /IPv6/);
  assert.equal(writes, before);
  records = records.filter(r => r.id !== "www");
  for (let i = 0; i < 105; i++) records.push({ ...records[4], id: `extra${i}`, name: `txt${i}.${root}` });
  assert.equal((await updateKeitaroDns(adapter, "zone", root, "203.0.113.96")).length, records.length, "Read every DNS page");
  malformed = true;
  await assert.rejects(updateKeitaroDns(adapter, "zone", root, "203.0.113.95"), /invalid DNS/);
  malformed = false;
  records = records.filter(r => r.type !== "A");
  await assert.rejects(updateKeitaroDns(adapter, "zone", root, "203.0.113.95"), /Root A record is missing/);
  console.log("PASS: IP validation, DNS pagination, partial failure/retry, idempotence, all root A records, www aliases, IPv6/conflict checks, TXT/MX/subdomain preservation and PATCH preserves TTL/proxy/comments. All HTTP mocked.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
