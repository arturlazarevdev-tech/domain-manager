import { loadEnvConfig } from "@next/env";
import { encryptJson } from "../src/lib/crypto";
import { createRegistrarAdapter } from "../src/lib/integrations/registrars/factory";
import assert from "node:assert/strict";
import { OpenProviderAdapter, openproviderContact } from "../src/lib/integrations/registrars/openprovider/adapter";
import { OpenproviderClient } from "../src/lib/integrations/registrars/openprovider/client";
import { openproviderCredentialsSchema } from "../src/lib/integrations/registrars/openprovider/credentials";
import { parseRegistrarCredentials } from "../src/lib/integrations/registrars/credentials";
import type { RegistrantContact } from "../src/lib/integrations/types";

type Call = { url: URL; method: string; body: Record<string, unknown>; auth: string | null };
const calls: Call[] = [];
const originalFetch = globalThis.fetch;
const contact: RegistrantContact = { name: "Max Smith", email: "max@example.com", phone: "5551234", phoneCc: "1", phoneAreaCode: "212", country: "us", state: "NY", city: "New York", address: "10 Main Street", zip: "10001" };
let handler: (call: Call) => unknown = () => ({});
function reply(data: unknown, code = 0, status = 200, desc = "") { return Response.json({ code, data, desc }, { status }); }
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  const call: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : {}, auth: new Headers(init?.headers).get("Authorization") };
  calls.push(call);
  if (url.pathname.endsWith('/auth/login')) return reply({ token: `test-token-${calls.length}` });
  const result = handler(call);
  return result instanceof Response ? result : reply(result);
}) as typeof fetch;

async function main() {
  assert(!openproviderCredentialsSchema.safeParse({ username: "", password: "secret" }).success);
  assert(!openproviderCredentialsSchema.safeParse({ username: "user", password: "" }).success);
  assert.equal(parseRegistrarCredentials("regway", { authUserId: "123", apiKey: "key" }).sandbox, false);
  const adapter = new OpenProviderAdapter({ username: "test", password: "test-password", sandbox: false });
  handler = (call) => {
    assert.equal(call.url.origin, "https://api.openprovider.eu");
    assert(call.auth?.startsWith("Bearer test-token-"));
    if (call.url.pathname === '/v1/resellers') { assert.equal(call.url.searchParams.get('with_settings'), 'true'); return { balance: 150, reserved_balance: 5, settings: { currency: "EUR" } }; }
    if (call.url.pathname === '/v1/domains/check') return { results: (call.body.domains as { name: string; extension: string }[]).map((d, i) => ({ domain: `${d.name}.${d.extension}`, status: i ? "active" : "free", is_premium: false, price: { reseller: { price: 2.5, currency: "EUR" } } })) };
    if (call.url.pathname === '/v1/domains/prices') { assert.equal(call.url.searchParams.get('domain.extension'), 'co.uk'); assert.equal(call.url.searchParams.get('domain.name'), 'example'); assert.equal(call.url.searchParams.get('operation'), 'create'); return { price: { reseller: { price: 2.5, currency: "EUR" }, product: { price: 99, currency: "USD" } }, tier_price: { reseller: { price: 10, currency: "EUR" } }, is_promotion: true }; }
    return {};
  };
  assert.deepEqual(await adapter.getBalance(), { amount: 150, currency: "EUR", lockedAmount: 5 });
  assert.deepEqual(await adapter.testConnection(), { ok: true });
  const checked = await adapter.checkDomains(["EXAMPLE.co.uk", "taken.com", "example.co.uk"]);
  assert.equal(checked.length, 2);
  assert.equal(checked[0].available, true);
  assert.equal(checked[1].available, false);
  assert.deepEqual(checked[0].price?.registration, { amount: 2.5, currency: "EUR" });
  const price = await adapter.getPrice("example.co.uk");
  assert.equal(price.registration.amount, 2.5);
  assert.equal(price.listRegistration?.amount, 10);
  assert.equal(calls.filter(c => c.url.pathname.endsWith('/auth/login')).length, 1);

  // Lists follow the provider's total count rather than truncating at one page.
  handler = (call) => {
    if (call.url.pathname === '/v1/tlds') return { total: 101, results: call.url.searchParams.get('offset') === '0' ? Array.from({ length: 100 }, (_, i) => ({ name: `tld${i}` })) : [{ name: "co.uk" }] };
    if (call.url.pathname === '/v1/domains' && call.method === 'GET') return { total: 1, results: [{ id: 42, domain: { name: 'example', extension: 'co.uk' }, status: 'ACT' }] };
    if (call.url.pathname === '/v1/domains/42' && call.method === 'GET') return { id: 42, domain: { name: 'example', extension: 'co.uk' }, status: 'ACT', active_date: '2026-10-13 10:00:00', renewal_date: '2027-10-13 10:00:00', name_servers: [{ name: 'ns1.example.net' }] };
    if (call.url.pathname === '/v1/domains/42' && call.method === 'PUT') { assert.deepEqual(call.body, { name_servers: [{ name: 'beth.ns.cloudflare.com' }, { name: 'koa.ns.cloudflare.com' }] }); return {}; }
    throw new Error('Unexpected path');
  };
  assert.equal((await adapter.listTlds()).length, 101);
  assert.equal((await adapter.listDomains())[0].orderId, '42');
  assert.equal((await adapter.getDomain('example.co.uk')).registeredAt?.toISOString(), '2026-10-13T10:00:00.000Z');
  await adapter.setNameservers('example.co.uk', ['beth.ns.cloudflare.com', 'koa.ns.cloudflare.com']);
  await assert.rejects(adapter.setNameservers('example.co.uk', ['one.example']), /At least two/);

  handler = (call) => {
    if (call.url.pathname === '/v1/customers') { assert.deepEqual(call.body, openproviderContact(contact)); return { handle: 'MS123456-US' }; }
    if (call.url.pathname === '/v1/domains' && call.method === 'POST') {
      assert.equal(call.body.owner_handle, 'MS123456-US');
      assert.equal(call.body.autorenew, 'off');
      assert.equal(call.body.ns_group, 'dns-openprovider');
      assert.deepEqual(call.body.domain, { name: 'example', extension: 'com' });
      assert.deepEqual(call.body.additional_data, { consent_for_publishing: '0' });
      return { id: 123, status: 'ACT', activation_date: '2026-10-13 10:00:00', expiration_date: '2027-10-13 10:00:00' };
    }
    throw new Error('Unexpected path');
  };
  const registered = await adapter.registerDomain({ domain: 'example.com', contact });
  assert.equal(registered.orderId, '123');
  assert.equal(registered.registrationStatus, "purchased");
  assert.equal(registered.externalContactId, 'MS123456-US');
  assert.equal(registered.registeredAt?.getUTCFullYear(), 2026);
  assert.throws(() => openproviderContact({ ...contact, name: 'Max' }), /first and last/);
  assert.throws(() => openproviderContact({ ...contact, address: 'Main Street' }), /house number/);
  assert.throws(() => openproviderContact({ ...contact, phoneAreaCode: '' }), /Phone area code/);
  assert.equal(openproviderContact({ ...contact, address: 'Main Street 10' }).address.number, '10');
  assert.equal(openproviderContact({ ...contact, phone: '+1 212 5551234' }).phone.subscriber_number, '5551234');
  const before = calls.filter(c => c.url.pathname.endsWith('/customers')).length;
  handler = (call) => {
    assert.equal(call.url.pathname, '/v1/domains');
    assert.deepEqual(call.body.name_servers, [{ name: 'ns1.example.net' }, { name: 'ns2.example.net' }]);
    assert(!('ns_group' in call.body));
    return { id: 124, status: 'REQ' };
  };
  const pendingRegistration = await adapter.registerDomain({ domain: 'example.com', contact, extra: { contactId: 'MS123456-US' }, nameservers: ['ns1.example.net', 'ns2.example.net'] });
  assert.equal(pendingRegistration.registrationStatus, "pending");
  assert.equal(calls.filter(c => c.url.pathname.endsWith('/customers')).length, before);

  // Nonzero code in an HTTP 200 still fails, and credentials are redacted.
  handler = () => reply({}, 112, 200, 'Rejected test-password');
  await assert.rejects(adapter.getBalance(), error => error instanceof Error && error.message.includes('Rejected [redacted]') && !error.message.includes('test-password'));
  handler = () => ({ price: { product: { price: 1, currency: 'EUR' } } });
  await assert.rejects(adapter.getPrice('example.co.uk'), /account currency/);
  handler = () => ({ results: [] });
  assert.equal((await adapter.checkDomain('missing.com')).available, false);

  let failedAuth = false;
  handler = () => {
    if (!failedAuth) { failedAuth = true; return reply({}, 401, 401, 'Expired token'); }
    return { balance: 42, settings: { currency: 'USD' } };
  };
  assert.equal((await adapter.getBalance()).amount, 42);
  assert.equal(calls.filter(c => c.url.pathname.endsWith('/auth/login')).length, 2);

  loadEnvConfig(process.cwd());
  const created = createRegistrarAdapter({ provider: "openprovider", credentialsEncrypted: encryptJson({ username: "factory-user", password: "factory-password", sandbox: false }), defaultNameservers: [] });
  handler = () => ({ balance: 12, settings: { currency: "EUR" } });
  assert.equal(created.provider, "openprovider");
  assert.equal((await created.getBalance()).amount, 12);

  const sandbox = new OpenproviderClient({ username: 'sandbox', password: 'sandbox-password', sandbox: true });
  handler = call => { assert.equal(call.url.origin, 'https://api.sandbox.openprovider.nl'); assert.equal(call.url.pathname, '/v1beta/resellers'); return {}; };
  await sandbox.request('/resellers');
  // An uncertain financial request is never replayed automatically.
  let attempts = 0;
  handler = () => { attempts++; throw new TypeError('Network interrupted'); };
  await assert.rejects(sandbox.request('/domains', 'POST', {}), /Check the domain/);
  assert.equal(attempts, 1);
  console.log('PASS: Openprovider authentication/cache/refresh, sandbox, balances, availability, account prices, promotions, pagination, registration/contact reuse, nameservers, validation, error redaction and no replay on uncertain purchases. All API calls mocked.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
