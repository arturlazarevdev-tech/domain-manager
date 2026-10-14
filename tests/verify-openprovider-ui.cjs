const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { loadEnvConfig } = require('@next/env');
const { PrismaClient } = require('@prisma/client');
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = 'http://localhost:3000';
let accountId, profileId, chrome, ws;
async function main() {
  const { SignJWT } = await import('jose');
  const user = await db.user.findFirstOrThrow({ where: { role: 'admin' } });
  const token = await new SignJWT({ id: user.id, email: user.email, role: user.role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const headers = { cookie: 'dm_session=' + token, 'Content-Type': 'application/json' };
  async function api(path, method = 'GET', body) {
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    assert(res.ok, JSON.stringify(data));
    return data;
  }
  const name = 'Openprovider UI test ' + Date.now();
  const invalid = await fetch(base + '/api/registrars', { method: 'POST', headers, body: JSON.stringify({ name, provider: 'openprovider', credentials: { apiKey: 'wrong-field' } }) });
  assert.equal(invalid.status, 400);
  const password = crypto.randomUUID();
  const account = (await api('/api/registrars', 'POST', { name, provider: 'openprovider', credentials: { username: 'test-user', password, sandbox: true } })).registrar;
  accountId = account.id;
  assert.equal(account.sandbox, true);
  for (const key of ['credentialsEncrypted', 'password', 'username', 'apiKey']) assert(!(key in account));
  assert(!JSON.stringify(account).includes(password));
  const updated = (await api('/api/registrars/' + accountId, 'PATCH', { name: name + ' edited', provider: 'openprovider', credentials: { username: '', password: '', sandbox: true } })).registrar;
  assert.equal(updated.sandbox, true);
  const stored = await db.registrarAccount.findUniqueOrThrow({ where: { id: accountId } });
  assert.notEqual(stored.credentialsEncrypted, password);
  const profile = (await api('/api/registrants', 'POST', { name: 'Max Smith', label: 'for Openprovider', registrarId: accountId, email: 'test@example.com', phone: '5551234', phoneCc: '1', phoneAreaCode: '212', country: 'US', state: 'NY', city: 'New York', address: 'Main Street 10', zip: '10001', isDefault: false })).registrant;
  profileId = profile.id;
  assert.equal(profile.phoneAreaCode, '212');
  assert.equal(profile.registrar.id, accountId);
  assert.equal((await api('/api/registrars')).registrars.find(a => a.id === accountId).provider, 'openprovider');

  const port = 9259;
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + port, '--user-data-dir=/private/tmp/bydomen-openprovider-test-' + Date.now(), '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert(tabs, 'Chrome started');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = e => { const msg = JSON.parse(e.data); if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text); };
  const call = (method, params = {}) => new Promise(resolve => { const seq = ++id; pending.set(seq, resolve); ws.send(JSON.stringify({ id: seq, method, params })); });
  async function evaluate(expression) { const r = await call('Runtime.evaluate', { expression, returnByValue: true }); assert(!r.result?.exceptionDetails, JSON.stringify(r)); return r.result.result.value; }
  async function until(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 200)); } throw new Error('Timeout: ' + expression); }
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Network.setCookie', { name: 'dm_session', value: token, url: base, httpOnly: true });
  await call('Page.navigate', { url: base + '/settings/registrars' });
  await until(`document.body.innerText.includes(${JSON.stringify(name + ' edited')})`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add').click()`);
  await until(`Boolean(document.querySelector('option[value="openprovider"]'))`);
  await evaluate(`(() => { const select = Array.from(document.querySelectorAll('select')).find(s => Array.from(s.options).some(o => o.value === 'openprovider')); select.value = 'openprovider'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(`Boolean(document.querySelector('input[placeholder="Openprovider username"]')) && Boolean(document.querySelector('input[type="password"][placeholder="Openprovider password"]'))`);
  assert.equal(await evaluate(`document.body.innerText.includes('Reseller ID')`), false);
  await call('Page.navigate', { url: base + '/domains/purchase' });
  await until(`Array.from(document.querySelectorAll('select option')).some(o => o.value === ${JSON.stringify(accountId)})`);
  // Verify profile form exposes the additional phone field without submitting a purchase.
  await call('Page.navigate', { url: base + '/settings/registrants' });
  await until(`document.body.innerText.includes('Max Smith (for Openprovider)')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Add').click()`);
  await until(`document.body.innerText.includes('Phone area code (required for Openprovider)')`);
  assert.deepEqual(errors, []);
  console.log('PASS: API credential validation, encrypted account save/edit, no secret disclosure, Openprovider registrant/area code, provider-specific UI, account available on Buy Domains. Temporary records removed. No calls to Openprovider or domain purchases.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (ws) ws.close();
  if (chrome) chrome.kill('SIGTERM');
  if (profileId) await db.registrantProfile.delete({ where: { id: profileId } });
  if (accountId) await db.registrarAccount.delete({ where: { id: accountId } });
  await db.$disconnect();
});
