import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/db";
import { encryptJson } from "../src/lib/crypto";
import { addManualDomain, updateManagedDomain, addDomainTxt, normalizeManagedDomain, txtRecordName } from "../src/lib/services/domain-management";
import { refreshCloudflareStatus } from "../src/lib/services/provisioning";
import { manualDomainSchema } from "../src/lib/validators";

loadEnvConfig(process.cwd());
const tag = crypto.randomUUID();
const name = `management-${tag}.example`;
const originalFetch = globalThis.fetch;
const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
let registrarId: string, cfId: string, ktId: string, hsId: string, buyerId: string, domainId: string;
let forceFailure = false;
let cloudflareUnavailable = false;
let malformedDns = false;
const records = [
  { id: "old-txt", type: "TXT", name, content: "old-verification", proxied: false },
  { id: "old-mx", type: "MX", name, content: "mail.example", proxied: false },
  { id: "old-a", type: "A", name, content: "203.0.113.9", proxied: false },
];
let groupId = 1;
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? typeof init.body === "string" ? JSON.parse(init.body) : Object.fromEntries(init.body as URLSearchParams) : {};
  requests.push({ path: url.pathname + url.search, method, body });
  if (url.hostname === "api.cloudflare.com") {
    if (cloudflareUnavailable) return Response.json({ success: false, errors: [{ message: "Cloudflare unavailable" }] }, { status: 502 });
    if (url.pathname.endsWith('/zones/test-zone')) return Response.json({ success: true, result: { id: 'test-zone', name, status: 'active', name_servers: ['ns1.example', 'ns2.example'] } });
    if (url.pathname.endsWith('/zones')) return Response.json({ success: true, result: [{ id: 'test-zone', name, status: 'active', name_servers: ['ns1.example', 'ns2.example'] }] });
    if (url.pathname.endsWith('/dns_records') && method === 'GET') {
      if (malformedDns) return Response.json({ success: true, result: {} });
      const found = records.filter(r => (!url.searchParams.get('type') || r.type === url.searchParams.get('type')) && (!url.searchParams.get('name') || r.name === url.searchParams.get('name')));
      const page = Number(url.searchParams.get('page') ?? 1);
      return Response.json({ success: true, result: found.slice((page - 1) * 100, page * 100), result_info: { total_pages: Math.max(1, Math.ceil(found.length / 100)) } });
    }
    if (method === 'POST' && url.pathname.endsWith('/dns_records')) {
      const record = { ...body, id: `record-${records.length}`, proxied: Boolean(body.proxied) } as typeof records[number];
      records.push(record);
      return Response.json({ success: true, result: record });
    }
    if (method === 'PUT' && url.pathname.includes('/dns_records/')) {
      const record = records.find(r => url.pathname.endsWith('/' + r.id))!;
      Object.assign(record, body);
      return Response.json({ success: true, result: record });
    }
    if (method === 'DELETE') throw new Error('No fixture DNS records should be deleted');
  }
  if (url.hostname === 'keitaro.invalid') {
    if (forceFailure && method === 'PUT') return Response.json({ error: 'Group rejected' }, { status: 400 });
    if (url.pathname.endsWith('/domains')) return Response.json([{ id: 50, name, state: 'active', group: groupId === 1 ? 'Old buyer' : 'Correct buyer' }]);
    if (url.pathname.endsWith('/groups') && method === 'GET') return Response.json([{ id: 2, name: 'Correct buyer', type: 'domains' }]);
    if (url.pathname.endsWith('/domains/50') && method === 'PUT') { groupId = Number(body.group_id); assert(!('notes' in body)); return Response.json({ id: 50, name, state: 'active', group: 'Correct buyer' }); }
  }
  if (url.hostname === 'hestia.invalid') {
    if (body.cmd === 'v-add-web-domain') return new Response('4');
    if (body.cmd === 'v-change-web-domain-ip') return new Response('0');
  }
  throw new Error(`Unexpected external call blocked: ${method} ${url.origin}${url.pathname}`);
}) as typeof fetch;

async function main() {
  assert.equal(normalizeManagedDomain(' Example.COM. '), 'example.com');
  assert.throws(() => normalizeManagedDomain('https://example.com/path'));
  assert.equal(txtRecordName('example.com', '@'), 'example.com');
  assert.equal(txtRecordName('example.com', '_acme-challenge'), '_acme-challenge.example.com');
  assert.equal(txtRecordName('example.com', '_dmarc.example.com.'), '_dmarc.example.com');
  assert.throws(() => txtRecordName('example.com', 'other.com.'));
  registrarId = (await prisma.registrarAccount.create({ data: { name: tag, provider: 'regway', credentialsEncrypted: encryptJson({ authUserId: 'test', apiKey: 'test' }) } })).id;
  cfId = (await prisma.cloudflareAccount.create({ data: { name: tag, accountId: 'a'.repeat(32), credentialsEncrypted: encryptJson({ apiToken: 'test', accountId: 'a'.repeat(32) }) } })).id;
  ktId = (await prisma.keitaroServer.create({ data: { name: tag, url: 'https://keitaro.invalid', ipAddress: '203.0.113.10', credentialsEncrypted: encryptJson({ apiKey: 'test' }) } })).id;
  hsId = (await prisma.hestiaServer.create({ data: { name: tag, url: 'https://hestia.invalid', username: 'admin', ipAddress: '203.0.113.20', credentialsEncrypted: encryptJson({ accessKey: 'test', secretKey: 'test' }) } })).id;
  buyerId = (await prisma.buyer.create({ data: { name: 'Correct buyer ' + tag } })).id;
  const input = manualDomainSchema.parse({ domain: name, registrarId, buyerId, purchasePrice: 12.5, currency: 'USD', purchasedAt: '2020-06-01T12:00:00Z', cloudflareAccountId: cfId, serverType: 'keitaro', serverId: ktId, serverIp: '203.0.113.9', mode: 'existing', keitaroGroup: 'Old buyer' });
  const imported = await addManualDomain(input);
  domainId = imported.domain.id;
  assert.deepEqual(imported.warnings, []);
  assert.equal(imported.domain.purchasePrice, 12.5);
  assert.equal(imported.domain.purchasedAt?.getUTCFullYear(), 2020);
  assert.equal(imported.domain.keitaro?.groupName, 'Old buyer');
  assert(requests.every(r => r.method === 'GET'));
  await assert.rejects(addManualDomain(input), /already in Purchased/);

  await addDomainTxt(domainId, { name: '@', content: 'new-verification' });
  assert.equal(records.filter(r => r.type === 'TXT' && r.name === name).length, 2);
  const posts = requests.filter(r => r.method === 'POST').length;
  await addDomainTxt(domainId, { name: '@', content: 'new-verification' });
  assert.equal(requests.filter(r => r.method === 'POST').length, posts);
  const updated = await updateManagedDomain(domainId, { ...input, mode: 'configure', serverIp: '203.0.113.15', keitaroGroup: 'Correct buyer' });
  assert.deepEqual(updated.warnings, []);
  assert.equal(updated.domain.keitaro?.serverIp, '203.0.113.15');
  assert.equal(updated.domain.keitaro?.groupName, 'Correct buyer');
  assert.equal(groupId, 2);
  assert(records.some(r => r.type === 'MX'));
  assert.equal(records.filter(r => r.type === 'TXT').length, 2);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId, type: 'TXT' } }), 2);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId, type: 'MX' } }), 1);
  assert.equal(requests.filter(r => r.path.endsWith('/domains') && r.method === 'POST').length, 0);
  await assert.rejects(updateManagedDomain(domainId, { ...input, serverIp: 'not-an-ip' }), /IPv4/);

  forceFailure = true;
  const failed = await updateManagedDomain(domainId, { ...input, mode: 'configure', serverIp: '203.0.113.99', keitaroGroup: 'Correct buyer' });
  assert(failed.warnings[0].includes('Group rejected'));
  assert.equal(records.find(r => r.type === 'A' && r.name === name)?.content, '203.0.113.15');
  forceFailure = false;
  const moved = await updateManagedDomain(domainId, { ...input, mode: 'configure', serverType: 'hestia', serverId: hsId, serverIp: '203.0.113.20', hestiaUser: 'admin' });
  assert.deepEqual(moved.warnings, []);
  assert.equal(moved.domain.keitaro, null);
  assert.equal(moved.domain.hestia?.ip, '203.0.113.20');
  assert(requests.some(r => r.body.cmd === 'v-change-web-domain-ip' && r.body.arg3 === '203.0.113.20'));
  assert.equal(records.filter(r => r.type === 'TXT').length, 2);
  // Refresh replaces the local snapshot, including deletions made outside this app.
  records.splice(records.findIndex(row => row.id === 'old-txt'), 1);
  await refreshCloudflareStatus(domainId);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId, type: 'TXT' } }), 1);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId, providerId: 'old-txt' } }), 0);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId, type: 'MX' } }), 1);
  const snapshotCount = await prisma.domainDnsRecord.count({ where: { domainId } });
  malformedDns = true;
  await assert.rejects(refreshCloudflareStatus(domainId), /invalid DNS record list/);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId } }), snapshotCount);
  malformedDns = false;
  for (let i = 0; i < 101; i++) records.push({ id: `page-record-${i}`, type: 'TXT', name: `check${i}.${name}`, content: 'token', proxied: false });
  await refreshCloudflareStatus(domainId);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId } }), records.length);
  assert(requests.some(row => row.path.includes('page=2')));
  records.length = 0;
  await refreshCloudflareStatus(domainId);
  assert.equal(await prisma.domainDnsRecord.count({ where: { domainId } }), 0);
  cloudflareUnavailable = true;
  const offline = await updateManagedDomain(domainId, { ...input, mode: 'existing' });
  assert(offline.warnings[0].includes('Cloudflare unavailable'));
  assert.equal(offline.domain.keitaro?.server.id, ktId);
  assert.equal(offline.domain.keitaro?.status, 'not_added');
  assert.equal(offline.domain.hestia, null);
  cloudflareUnavailable = false;
  console.log('PASS: historical import, read-only mode, duplicate guard, validation, buyer attribution, Keitaro group PUT, IP change, TXT coexistence/idempotency, TXT/MX preservation, partial errors, Hestia existing-domain IP update, DNS deletions/empty zones/pagination and failure-safe refresh. All external calls mocked.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  globalThis.fetch = originalFetch;
  if (domainId) await prisma.domain.delete({ where: { id: domainId } });
  if (buyerId) await prisma.buyer.delete({ where: { id: buyerId } });
  if (ktId) await prisma.keitaroServer.delete({ where: { id: ktId } });
  if (hsId) await prisma.hestiaServer.delete({ where: { id: hsId } });
  if (cfId) await prisma.cloudflareAccount.delete({ where: { id: cfId } });
  if (registrarId) await prisma.registrarAccount.delete({ where: { id: registrarId } });
  await prisma.$disconnect();
});
