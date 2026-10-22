import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { RegwayAdapter } from '../src/lib/integrations/registrars/regway/adapter';
const originalFetch = globalThis.fetch, originalLookup = dns.lookup;
const defaults = ['dns4.parkpage.foundationapi.com', 'dns3.parkpage.foundationapi.com'];
let registrations = 0, defaultReads = 0, response: unknown = defaults, failing: string[] = [], dnsCode = 'ENOTFOUND';
const lookups: string[] = [];
dns.lookup = (async (name: string) => {
  lookups.push(name);
  if (failing.includes(name)) throw Object.assign(new Error('DNS unavailable'), { code: dnsCode });
  return { address: '192.0.2.1', family: 4 };
}) as typeof dns.lookup;
let expected = defaults;
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, 'httpapi.com', 'Tests cannot call real providers');
  if (url.pathname.endsWith('/customer-default-ns.json')) {
    assert.equal(init?.method, 'GET'); assert.equal(url.searchParams.get('customer-id'), '7');
    defaultReads++; return Response.json(response);
  }
  if (url.pathname.endsWith('/register.json')) {
    registrations++; assert.equal(init?.method, 'POST');
    const body = new URLSearchParams(String(init?.body));
    assert.deepEqual(body.getAll('ns'), expected);
    assert(expected.every(name => lookups.includes(name)), 'Check DNS before submitting a financial request');
    return Response.json({ entityid: '42' });
  }
  if (url.pathname.includes('/billing/')) return Response.json({ recsindb: '0' });
  throw new Error(`Unexpected request: ${url.pathname}`);
}) as typeof fetch;
const credentials = { authUserId: 'test', apiKey: 'test', sandbox: false };
const request = { domain: 'example.net', extra: { customerId: '7', contactId: '8' }, contact: { name: 'Test', email: 'test@example.invalid', phone: '1234567890', country: 'US', state: 'CA', city: 'Test', address: '1 Test St', zip: '90001' } };
async function main() {
  assert.deepEqual((await new RegwayAdapter(credentials).registerDomain(request)).nameservers, defaults);
  assert.equal(defaultReads, 1);
  failing = ['ns2.onlyfordns.net'];
  const adapter = new RegwayAdapter(credentials, { defaultNameservers: ['ns1.onlyfordns.net', 'ns2.onlyfordns.net'] });
  await adapter.registerDomain(request);
  assert.equal(defaultReads, 2, 'Invalid configured defaults fall back to official customer defaults');
  expected = ['ns1.custom.example', 'ns2.custom.example']; failing = [];
  const custom = new RegwayAdapter(credentials, { defaultNameservers: [' NS1.CUSTOM.EXAMPLE. ', 'ns2.custom.example', 'ns1.custom.example'] });
  assert.deepEqual((await custom.registerDomain(request)).nameservers, expected);
  assert.equal(defaultReads, 2, 'Valid configured defaults are preserved');
  expected = ['ns1.explicit.example', 'ns2.explicit.example'];
  await custom.registerDomain({ ...request, nameservers: expected });
  assert.equal(defaultReads, 2, 'Explicit per-domain NS take precedence');
  const before = registrations;
  failing = [expected[1]];
  await assert.rejects(custom.registerDomain({ ...request, nameservers: expected }), /could not be resolved/);
  assert.equal(defaultReads, 2, 'Explicit NS must not be silently replaced');
  await assert.rejects(custom.registerDomain({ ...request, nameservers: ['192.0.2.100', 'ns2.custom.example'] }), /valid nameservers/);
  failing = []; response = [];
  await assert.rejects(new RegwayAdapter(credentials).registerDomain(request), /valid nameservers/);
  response = { wrong: defaults };
  await assert.rejects(new RegwayAdapter(credentials).registerDomain(request), /did not return/);
  response = defaults; failing = [defaults[0]];
  await assert.rejects(new RegwayAdapter(credentials).registerDomain(request), /could not be resolved/);
  failing = ['ns1.custom.example']; dnsCode = 'EAI_AGAIN';
  const readsBefore = defaultReads;
  await assert.rejects(custom.registerDomain(request), /could not be resolved/);
  assert.equal(defaultReads, readsBefore, 'Temporary DNS failures do not replace custom settings');
  assert.equal(registrations, before, 'Invalid or unverified NS never reach registration/payment');
  console.log('PASS: official Regway customer defaults, DNS validation before payment, invalid-default recovery, explicit NS precedence, malformed defaults, transient DNS failures and no automatic financial retries. All DNS and HTTP calls mocked.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; dns.lookup = originalLookup; });
