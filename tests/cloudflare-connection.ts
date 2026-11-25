import assert from "node:assert/strict";
import { CloudflareAdapter } from "../src/lib/integrations/cloudflare/adapter";

const accountId = "a".repeat(32);
const originalFetch = globalThis.fetch;
const requests: string[] = [];
let tokenState = "active", accountAllowed = true, zonesAllowed = true;
let zoneAccount: string | undefined = accountId;
let emptyZones = false;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.cloudflare.com");
  assert.equal(init?.method ?? "GET", "GET", "Connection tests never write to Cloudflare");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
  requests.push(url.pathname + url.search);
  if (url.pathname.endsWith("/user/tokens/verify")) return Response.json({ success: true, result: { status: tokenState } });
  if (url.pathname.includes("/accounts/")) return accountAllowed
    ? Response.json({ success: true, result: { id: accountId } })
    : Response.json({ success: false, errors: [{ message: "Unauthorized to access requested resource" }] }, { status: 403 });
  assert.equal(url.pathname, "/client/v4/zones");
  assert.equal(url.searchParams.get("account.id"), accountId);
  assert.equal(url.searchParams.get("per_page"), "1");
  return zonesAllowed
    ? Response.json({ success: true, result: emptyZones ? [] : [{ account: zoneAccount ? { id: zoneAccount } : undefined }] })
    : Response.json({ success: false, errors: [{ message: "Zone access denied" }] }, { status: 403 });
};

async function main() {
  const adapter = new CloudflareAdapter({ apiToken: "test-token", accountId });
  assert.equal((await adapter.testConnection()).ok, true);
  assert.equal(requests.length, 2, "Existing account-read tokens keep their current check");
  accountAllowed = false;
  assert.equal((await adapter.testConnection()).ok, true, "A zone-scoped token proves access to the matching account");
  zoneAccount = "b".repeat(32);
  assert.equal((await adapter.testConnection()).ok, false, "A different account in the response is rejected");
  zoneAccount = undefined;
  assert.equal((await adapter.testConnection()).ok, false, "A missing owner cannot prove account access");
  zoneAccount = accountId; emptyZones = true;
  assert.equal((await adapter.testConnection()).ok, false, "An empty filtered list does not prove ownership");
  emptyZones = false; zonesAllowed = false;
  assert.equal((await adapter.testConnection()).ok, false);
  zonesAllowed = true; tokenState = "disabled";
  const beforeInactive = requests.length;
  assert.equal((await adapter.testConnection()).ok, false);
  assert.equal(requests.length, beforeInactive + 1, "Inactive tokens never reach account checks");
  tokenState = "active";
  const beforeInvalidId = requests.length;
  assert.equal((await new CloudflareAdapter({ apiToken: "test-token", accountId: "email@example.com" }).testConnection()).ok, false);
  assert.equal(requests.length, beforeInvalidId + 1, "Account ID validation stays enforced");
  console.log("PASS: full and zone-scoped tokens, ownership mismatch, missing ownership, empty zones, denied access, inactive tokens and invalid account IDs. All HTTP mocked.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
