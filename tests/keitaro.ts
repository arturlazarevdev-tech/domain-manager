import assert from "node:assert/strict";
import { KeitaroAdapter } from "../src/lib/integrations/keitaro/adapter";
import { AppError, detailedErrorMessage } from "../src/lib/errors";

const originalFetch = globalThis.fetch;
type RemoteDomain = { id: number; name: string; state: string; notes?: string; group?: string };
const domains: RemoteDomain[] = [];
let mode: "supported" | "legacy" | "forbidden" | "network" | "malformed" | "malformed-create" = "legacy";
let arrayResponse = true, groupsExist = false;
const writes: Array<{ path: string; body: Record<string, unknown> }> = [];

globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://keitaro.invalid", "Real APIs are forbidden in this test");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (method !== "GET") writes.push({ path: url.pathname, body });
  if (url.pathname.endsWith("/groups")) {
    if (mode === "forbidden") return Response.json({ error: "Access denied" }, { status: 403 });
    if (mode === "network") return Response.json({ error: "Unavailable" }, { status: 503 });
    if (method === "GET") return Response.json(groupsExist ? [{ id: 8, name: "KIT", type: "domains" }] : []);
    if (mode === "legacy") return Response.json({ error: "Unknown group type" }, { status: 500 });
    groupsExist = true;
    return Response.json({ id: 8, name: "KIT", type: "domains" });
  }
  if (url.pathname.endsWith("/domains")) {
    if (method === "GET") return Response.json(mode === "malformed" ? {} : domains);
    const domain = { id: domains.length + 1, name: body.name, state: "active", notes: body.notes };
    domains.push(domain);
    return Response.json(mode === "malformed-create" ? [{}] : arrayResponse ? [domain] : domain);
  }
  const id = Number(url.pathname.split("/").pop());
  const domain = domains.find(item => item.id === id);
  if (domain) return Response.json(domain);
  throw new Error(`Unexpected request: ${method} ${url.pathname}`);
}) as typeof fetch;

async function main() {
  const adapter = () => new KeitaroAdapter("https://keitaro.invalid", { apiKey: "test" });
  const legacy = adapter();
  const first = await legacy.addDomain("first.example", { group: "KIT" });
  assert.equal(first.id, "1", "array response provides a real ID");
  const create = writes.find(item => item.path.endsWith("/domains"))!;
  assert(!("group_id" in create.body), "unsupported groups are omitted");
  assert.equal(create.body.notes, "KIT");
  const creations = writes.filter(item => item.path.endsWith("/domains")).length;
  await legacy.addDomain("first.example", { group: "KIT" });
  assert.equal(writes.filter(item => item.path.endsWith("/domains")).length, creations, "retries do not duplicate domains");
  assert(!writes.some(item => /\/domains\/\d+$/.test(item.path)), "legacy retries preserve remote notes and settings");
  await legacy.addDomain("second.example", { group: "KIT" });
  assert.equal(writes.filter(item => item.path.endsWith("/groups")).length, 1, "unsupported capability is remembered by the adapter");
  for (mode of ["forbidden", "network"] as const) {
    const before = domains.length;
    await assert.rejects(adapter().addDomain(`${mode}.example`, { group: "KIT" }), (error: unknown) => error instanceof AppError && !/Unknown group type/.test(error.details ?? ""));
    assert.equal(domains.length, before, "genuine errors must never be silently ignored");
  }
  mode = "supported";
  arrayResponse = false;
  const supported = adapter();
  const third = await supported.addDomain("third.example", { group: "KIT" });
  assert.equal(third.id, "3", "object creation response is supported");
  assert.equal(writes.findLast(item => item.path.endsWith("/domains"))!.body.group_id, "8");
  await supported.addDomain("third.example", { group: "KIT" });
  assert.equal(writes.findLast(item => item.path.endsWith("/domains/3"))!.body.group_id, "8", "supported groups remain editable");
  mode = "malformed";
  await assert.rejects(adapter().listDomains(), /invalid domain list/);
  mode = "malformed-create";
  await assert.rejects(adapter().addDomain("malformed.example"), /did not return the requested domain/);
  assert.equal(detailedErrorMessage(new AppError({ message: "Keitaro request failed", details: "Access denied" }), "Failed"), "Keitaro request failed: Access denied");
  console.log("PASS: legacy group fallback, real IDs from array/object responses, duplicate-free retries, preserved notes, supported groups, and visible permission/network/malformed-response errors. All API calls mocked.");
}

main().finally(() => { globalThis.fetch = originalFetch; }).catch(error => { console.error(error); process.exitCode = 1; });
