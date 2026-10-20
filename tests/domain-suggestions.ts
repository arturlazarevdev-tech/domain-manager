import assert from 'node:assert/strict';
import { generateAvailableDomains, generateCandidateNames, generateDomainsSchema } from '../src/lib/domain-generator';
import { DynadotAdapter } from '../src/lib/integrations/registrars/dynadot/adapter';
import type { DomainRegistrar } from '../src/lib/integrations/types';

async function main() {
  const a = new DynadotAdapter({ apiKey: 'test-suggestions', apiSecret: 'test-secret', sandbox: true });
  const client = (a as unknown as { client: { request: (...args: unknown[]) => Promise<unknown> } }).client;
  client.request = async (path, method, params) => {
    assert.equal(path, '/domains/cobalt.co.uk/suggestion_search');
    assert.equal(method, 'GET');
    assert.deepEqual(params, { tlds: 'co.uk', max_count: 100, show_price: false });
    return { domain_list: [{ domain_name: 'NICKELCOBALT.co.uk' }, { domain_name: 'nickelcobalt.co.uk' }, { domain_name: 'cobalt.com' }, { domain_name: 'sub.cobalt.co.uk' }, { domain_name: 'invalid / name' }, {}] };
  };
  assert.deepEqual(await a.suggestDomains('cobalt', '.co.uk', 500), ['nickelcobalt.co.uk']);
  let searches = 0;
  const registrar = {
    provider: 'dynadot',
    async suggestDomains(keyword: string, tld: string) {
      assert.equal(keyword, 'cobalt'); assert.equal(tld, 'digital');
      return ['nickelcobalt.digital', 'cobaltblue.digital', 'oldcobalt.digital', 'cobalt-7.digital', 'unrelated.com', 'takenname.digital', 'nickelcobalt.digital'];
    },
    async checkDomains(domains: string[]) {
      searches++;
      assert.deepEqual(domains, ['nickelcobalt.digital', 'cobaltblue.digital', 'takenname.digital']);
      return domains.map(domain => ({ domain, available: domain !== 'takenname.digital', price: { domain, registration: { amount: 2.5, currency: 'USD' } } }));
    },
    async getPrice() { throw Error('Bulk search already supplies live prices'); },
  } as unknown as DomainRegistrar;
  const input = generateDomainsSchema.parse({ type: 'suggestions', keyword: 'cobalt', tld: '.digital', amount: 3, minLength: 8, maxLength: 15, exclude: ['OLDCOBALT.digital'] });
  const result = await generateAvailableDomains(registrar, input);
  assert.equal(searches, 1);
  assert.deepEqual(result.available.map(d => d.domain), ['nickelcobalt.digital', 'cobaltblue.digital'], 'Related names need not start with the keyword');
  assert.equal(result.available[0].price?.registration.amount, 2.5);
  assert.equal(result.taken[0].domain, 'takenname.digital');
  assert.equal(result.timedOut, true);
  await assert.rejects(generateAvailableDomains({} as DomainRegistrar, input), /does not support/);
  for (const keyword of ['', 'a/b', 'a.b', 'a'.repeat(64)]) await assert.rejects(generateAvailableDomains(registrar, { ...input, keyword }), /keyword/);
  await assert.rejects(generateCandidateNames(input), /Find available/);
  assert.equal(generateDomainsSchema.safeParse({ ...input, minLength: 20, maxLength: 10 }).success, false);
  let priceCalls = 0;
  const local = { checkDomains: async (domains: string[]) => domains.map(domain => ({ domain, available: true, price: { domain, registration: { amount: 1, currency: 'USD' } } })), getPrice: async () => { priceCalls++; throw Error('unneeded'); } } as unknown as DomainRegistrar;
  assert.equal((await generateAvailableDomains(local, { ...input, keyword: undefined, type: 'random', amount: 2 })).available.length, 2);
  assert.equal(priceCalls, 0, 'Generation must not repeat already priced bulk searches');
  console.log('Domain suggestion tests passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
