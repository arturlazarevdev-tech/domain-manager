const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { loadEnvConfig } = require('@next/env');
const { PrismaClient } = require('@prisma/client');
loadEnvConfig(process.cwd());
const db = new PrismaClient();
let chrome, ws, domainId, cfId;
const domainName = 'ui-import-' + crypto.randomUUID() + '.example';
async function main() {
  const registrar = await db.registrarAccount.findFirstOrThrow({ where: { enabled: true }, select: { id: true, name: true } });
  const user = await db.user.findFirstOrThrow({ where: { role: 'admin' } });
  const { SignJWT } = await import('jose');
  const token = await new SignJWT({ id: user.id, email: user.email, role: user.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const port = 9265;
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + port, '--user-data-dir=/private/tmp/domain-management-ui-' + Date.now(), '--window-size=1440,1050', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert(tabs);
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const call = (method, params = {}) => new Promise(resolve => { const seq = ++id; pending.set(seq, resolve); ws.send(JSON.stringify({ id: seq, method, params })); });
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Fetch.requestPaused') call('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ balance: { amount: 100, currency: 'USD' } })).toString('base64') });
  };
  async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true }); assert(!r.result?.exceptionDetails, JSON.stringify(r)); return r.result.result.value; }
  async function until(expression) { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 200)); } throw new Error('Timeout: ' + expression); }
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*://localhost:3000/api/registrars/*/balance', requestStage: 'Request' }] });
  await call('Network.setCookie', { name: 'dm_session', value: token, url: 'http://localhost:3000', httpOnly: true });
  await call('Page.navigate', { url: 'http://localhost:3000/domains/purchased' });
  await until(`Boolean(document.querySelector('select[aria-label="Selected registrar"] option[value="${registrar.id}"]')) && document.body.innerText.includes('Export CSV')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === '+ Add domain').click()`);
  await until(`document.body.innerText.includes('Add existing domain') && document.body.innerText.includes('Save existing settings')`);
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/private/tmp/domain-management-dialog.png', Buffer.from(screenshot.result.data, 'base64'));
  async function setField(label, value) {
    await evaluate(`(() => { const label = Array.from(document.querySelectorAll('label')).find(el => el.querySelector('span')?.textContent === ${JSON.stringify(label)}); const input = label.querySelector('input,select,textarea'); const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  await setField('Domain', domainName);
  await setField('Registrar', registrar.id);
  await setField('Purchased date', '2020-06-01');
  await setField('Purchase price', '12.34');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add domain').click()`);
  await until(`document.body.innerText.includes(${JSON.stringify(domainName)}) && !document.body.innerText.includes('Add existing domain')`);
  const stored = await db.domain.findUniqueOrThrow({ where: { domain: domainName } });
  domainId = stored.id;
  assert.equal(Number(stored.purchasePrice), 12.34);
  assert.equal(stored.registeredAt.getFullYear(), 2020);
  assert.equal(await db.domainPurchase.count({ where: { domainId } }), 0);
  await evaluate(`Array.from(document.querySelectorAll('tbody tr')).find(row => row.innerText.includes(${JSON.stringify(domainName)})).querySelector('button').click()`);
  await until(`document.body.innerText.includes(${JSON.stringify('Update ' + domainName)})`);
  await setField('Purchase price', '24.68');
  await evaluate(`(() => { const h = Array.from(document.querySelectorAll('h2')).find(h => h.textContent === ${JSON.stringify('Update ' + domainName)}); Array.from(h.parentElement.parentElement.querySelectorAll('button')).find(b => b.textContent === 'Update').click(); })()`);
  await until(`!Array.from(document.querySelectorAll('h2')).some(h => h.textContent === ${JSON.stringify('Update ' + domainName)})`);
  assert.equal(Number((await db.domain.findUniqueOrThrow({ where: { id: domainId } })).purchasePrice), 24.68);
  cfId = (await db.cloudflareAccount.create({ data: { name: 'UI fixture ' + crypto.randomUUID(), accountId: 'b'.repeat(32), credentialsEncrypted: 'never-used-test-token' } })).id;
  await db.domainCloudflare.create({ data: { domainId, accountId: cfId, zoneId: 'never-used-test-zone', status: 'active' } });
  await call('Page.navigate', { url: 'http://localhost:3000/domains/purchased' });
  await until(`Array.from(document.querySelectorAll('tbody tr')).some(row => row.innerText.includes(${JSON.stringify(domainName)}) && Array.from(row.querySelectorAll('button')).some(b => b.textContent === 'Add TXT' && !b.disabled))`);
  await evaluate(`Array.from(document.querySelectorAll('tbody tr')).find(row => row.innerText.includes(${JSON.stringify(domainName)})).querySelectorAll('button')[1].click()`);
  await until(`document.body.innerText.includes(${JSON.stringify('Add TXT · ' + domainName)})`);
  assert(await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add TXT' && b.closest('.relative')).disabled`));
  await call('Page.navigate', { url: 'http://localhost:3000/domain/' + domainName });
  await until(`document.querySelector('h1')?.textContent === ${JSON.stringify(domainName)} && document.body.innerText.includes('Purchase')`);
  assert(await evaluate(`Array.from(document.querySelectorAll('main button')).some(b => b.textContent === 'Update')`));
  assert(await evaluate(`Array.from(document.querySelectorAll('main button')).some(b => b.textContent === 'Add TXT' && !b.disabled)`));
  assert.deepEqual(errors, []);
  console.log('PASS: manual import through UI/API with original purchase date, no purchase job, Update form persistence, TXT availability/input validation, detail-page actions. Temporary records removed; no external DNS/server mutations.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close(); if (chrome) chrome.kill('SIGTERM');
  if (!domainId) domainId = (await db.domain.findUnique({ where: { domain: domainName }, select: { id: true } }))?.id;
  if (domainId) await db.domain.delete({ where: { id: domainId } });
  if (cfId) await db.cloudflareAccount.delete({ where: { id: cfId } });
  await db.$disconnect();
});
