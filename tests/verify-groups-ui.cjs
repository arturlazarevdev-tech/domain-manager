const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { loadEnvConfig } = require('@next/env');
const { PrismaClient } = require('@prisma/client');
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = 'http://localhost:3000';
const port = 9257;
let chrome, ws, groupId, buyerId;
const failures = [];
async function main() {
  const { SignJWT } = await import('jose');
  const user = await db.user.findFirstOrThrow({ where: { role: 'admin' } });
  const token = await new SignJWT({ id: user.id, email: user.email, role: user.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  async function api(path, method = 'GET', body) {
    const res = await fetch(base + path, { method, headers: { cookie: 'dm_session=' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await res.json();
    assert(res.ok, `${path}: ${res.status} ${JSON.stringify(result)}`);
    return result;
  }
  const tag = Date.now();
  const groupName = `UI test group ${tag}`;
  const group = (await api('/api/buyer-groups', 'POST', { name: groupName })).group;
  groupId = group.id;
  const buyer = (await api('/api/buyers', 'POST', { name: `UI buyer ${tag}`, groupId })).buyer;
  buyerId = buyer.id;
  assert.equal((await api('/api/buyers')).buyers.find(b => b.id === buyerId).group.name, groupName);
  await api(`/api/buyer-groups/${groupId}`, 'PATCH', { name: groupName + ' renamed' });
  const invalid = await fetch(base + '/api/domains/purchase', { method: 'POST', headers: { cookie: 'dm_session=' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ domains: ['no-purchase.example'], registrarId: 'none', registrantId: 'none', cloudflareAccountId: 'none', buyerId, groupId }) });
  assert.equal(invalid.status, 400);
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + port, '--user-data-dir=/private/tmp/bydomen-groups-browser-' + tag, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert(tabs, 'Chrome started');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.text);
  };
  const call = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.result?.exceptionDetails, JSON.stringify(result));
    return result.result.result.value;
  }
  async function until(expression) { for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 250)); } throw new Error('UI timeout: ' + expression); }
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Network.setCookie', { name: 'dm_session', value: token, url: base, httpOnly: true });
  await call('Page.navigate', { url: base + '/settings/buyers' });
  await until(`document.body.innerText.includes(${JSON.stringify(groupName + ' renamed')})`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+ Add Buyer')).click()`);
  await until(`Array.from(document.querySelectorAll('select option')).some(o => o.value === ${JSON.stringify(groupId)})`);
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/private/tmp/bydomen-groups-buyers.png', Buffer.from(screenshot.result.data, 'base64'));
  await call('Page.navigate', { url: base + '/domains/purchased' });
  await until(`Boolean(document.querySelector('select[aria-label="Filter by group"]')) && Array.from(document.querySelectorAll('select[aria-label="Filter by group"] option')).some(o => o.value === ${JSON.stringify(groupId)})`);
  await evaluate(`(() => { const filter = document.querySelector('select[aria-label="Filter by group"]'); filter.value = ${JSON.stringify(groupId)}; filter.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await call('Page.navigate', { url: base + '/domains/purchase' });
  await until(`Array.from(document.querySelectorAll('select')).some(s => Array.from(s.options).some(o => o.value === 'group'))`);
  await until(`Array.from(document.querySelectorAll('select option')).some(o => o.value === ${JSON.stringify(buyerId)})`);
  await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'group')); select.value = 'group'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(`Array.from(document.querySelectorAll('select option')).some(o => o.value === ${JSON.stringify(groupId)})`);
  await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === ${JSON.stringify(groupId)})); select.value = ${JSON.stringify(groupId)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(`document.body.innerText.includes(${JSON.stringify(groupName + ' renamed (group needs)')})`);
  await call('Page.navigate', { url: base + '/' });
  await until(`document.body.innerText.includes('Spend by group') && document.body.innerText.includes(${JSON.stringify(groupName + ' renamed')})`);
  assert.deepEqual(failures, []);
  console.log('PASS: group create/rename, buyer membership, invalid purchase rejection, Buyers dialog, Purchased group filter, direct group purchase selection, Dashboard group cards; no browser exceptions.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close();
  if (chrome) chrome.kill('SIGTERM');
  if (buyerId) await db.buyer.delete({ where: { id: buyerId } });
  if (groupId) await db.buyerGroup.delete({ where: { id: groupId } });
  await db.$disconnect();
});
