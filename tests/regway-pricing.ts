import assert from 'node:assert/strict';
import { RegwayAdapter, registrationCharge, recentRegistrationCharge } from '../src/lib/integrations/registrars/regway/adapter';
const now = Date.now();
const invoice = { type: 'invoice', description: 'Registration of example.digital for 1 year', sellingamount: '-2.990', sellingcurrencysymbol: 'USD', transactiondate: String(Math.floor(now / 1000)) };
assert.deepEqual(registrationCharge({ 1: invoice, recsindb: '1' }, 'example.digital', 1, now), { amount: 2.99, currency: 'USD' });
for (const changed of [
  { type: 'credit' }, { description: 'Registration of example.digital.evil for 1 year' },
  { description: 'Renewal of example.digital for 1 year' }, { sellingamount: '2.99' },
  { sellingamount: '' }, { sellingamount: null }, { sellingamount: 'NaN' },
  { sellingcurrencysymbol: '' }, { transactiondate: '1' },
]) assert.equal(registrationCharge({ 1: { ...invoice, ...changed } }, 'example.digital', 1, now), undefined);
assert.equal(registrationCharge({ 1: invoice }, 'example.digital', 2), undefined);
assert.equal(registrationCharge({ 1: invoice, 2: { ...invoice, sellingamount: '-5' } }, 'example.digital', 1), undefined);
assert.deepEqual(registrationCharge({ 1: { ...invoice, sellingamount: '-5', transactiondate: '1' }, 2: invoice }, 'example.digital', 1), { amount: 2.99, currency: 'USD' });
assert.equal(recentRegistrationCharge({ 1: invoice }, 'digital', now)?.amount, 2.99);
for (const changed of [
  { type: 'credit' }, { description: 'Registration of example.digital.evil for 1 year' },
  { description: 'Renewal of example.digital for 1 year' }, { transactiondate: 'invalid' },
  { transactiondate: String(Math.floor(now / 1000) - 8 * 86400) },
  { transactiondate: String(Math.floor(now / 1000) + 86400) }, { sellingamount: '2.99' },
]) assert.equal(recentRegistrationCharge({ 1: { ...invoice, ...changed } }, 'digital', now), undefined);
const originalFetch = globalThis.fetch;
let invoiceFails = false, registrations = 0;
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/domains/register.json')) {
    assert.equal(init?.method, 'POST'); registrations++;
    return Response.json({ entityid: '123', sellingamount: '37.79' }); // Customer selling price is NOT our charge.
  }
  assert.equal(url.pathname, '/api/billing/my-transactions/search.json');
  assert.equal(url.searchParams.get('transaction-type'), 'invoice');
  assert.equal(url.searchParams.get('transaction-description'), invoice.description);
  assert(url.searchParams.has('transaction-date-start'));
  return invoiceFails ? Response.json({ status: 'ERROR', message: 'Invoice not ready' }) : Response.json({ 1: invoice });
}) as typeof fetch;
async function main() {
try {
  const adapter = new RegwayAdapter({ authUserId: 'test', apiKey: 'test', sandbox: false });
  const request = { domain: 'example.digital', extra: { customerId: '1', contactId: '2' }, contact: { name: 'Test', email: 'test@example.invalid', phone: '1234567890', country: 'US', state: 'CA', city: 'Test', address: '1 Test St', zip: '90001' } };
  assert.deepEqual((await adapter.registerDomain(request)).price, { amount: 2.99, currency: 'USD' });
  invoiceFails = true;
  const result = await adapter.registerDomain(request);
  assert.equal(result.orderId, '123');
  assert.equal(result.price, undefined);
  assert.equal(registrations, 2, 'Invoice lookup failure must not repeat registration');
  let historyRequests = 0;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/reseller-cost-price.json')) return Response.json({ dotdigital: { addnewdomain: { 1: '44.59' }, renewdomain: { 1: '49.39' } } });
    if (url.pathname.endsWith('/my-transactions/search.json')) {
      historyRequests++;
      assert.equal(url.searchParams.get('transaction-description'), '.digital for 1 year');
      assert.equal(url.searchParams.get('transaction-type'), 'invoice');
      const account = url.searchParams.get('auth-userid');
      return Response.json({ 1: { ...invoice, sellingamount: account === 'other' ? '-3.19' : '-2.99' }, recsindb: '1' });
    }
    assert(url.pathname.endsWith('/promo-details.json'));
    return Response.json(url.searchParams.get('auth-userid') === 'with-promo' ? { 1: { productkey: 'dotdigital', actiontype: 'addnewdomain', period: '1', isactive: 'true', resellerprice: '2.99' } } : {});
  }) as typeof fetch;
  const estimated = await adapter.getPrice('example.digital');
  assert.equal(estimated.estimated, true);
  assert.equal(estimated.registration.amount, 44.59, 'Missing promotion must not become a fabricated discount');
  assert.equal(estimated.recentRegistration?.amount, 2.99, 'Historical charge is separate from the current quote');
  await Promise.all(Array.from({ length: 20 }, () => adapter.getPrice('batch.digital')));
  assert.equal(historyRequests, 1, 'A bulk search shares one billing lookup');
  const other = await new RegwayAdapter({ authUserId: 'other', apiKey: 'test', sandbox: false }).getPrice('example.digital');
  assert.equal(other.recentRegistration?.amount, 3.19, 'History is isolated per registrar account');
  const promoted = await new RegwayAdapter({ authUserId: 'with-promo', apiKey: 'test', sandbox: false }).getPrice('example.digital');
  assert.equal(promoted.estimated, false);
  assert.equal(promoted.registration.amount, 2.99);
  assert.equal(promoted.renewal?.amount, 49.39);
  assert.equal(promoted.recentRegistration, undefined, 'Live promotion takes precedence over historical prices');

  console.log('PASS: exact reseller invoice, amount/currency/date validation, refunds and renewals excluded, customer selling price ignored, completed registration preserved when billing lookup fails. All API calls mocked.');
} finally { globalThis.fetch = originalFetch; }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
