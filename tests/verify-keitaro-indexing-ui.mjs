import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { SignJWT } from 'jose';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:33004';
const session = { email: 'suggestions@example.invalid', token: await new SignJWT({ id: 'local-test', role: 'tech' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('local-indexing-preview-not-production')) };
const registrarId = 'dynadot-local-test';
const profile = `/private/tmp/bydomen-indexing-ui-${Date.now()}`;
const assignmentCalls = [];
let chrome, ws;
async function main() {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9284', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:9284/json/list')).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert(tabs, 'Chrome started');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const forbidden = [];
  const unexpected = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    if (message.method === 'Fetch.requestPaused') {
      const path = new URL(message.params.request.url).pathname;
      if (path.includes('/api/domains/purchase')) {
        forbidden.push(path);
        call('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' });
      } else {
        if (path.endsWith('/keitaro') && message.params.request.method === 'POST') assignmentCalls.push(JSON.parse(message.params.request.postData));
        const fixtures = {
          '/api/auth/me': { user: { email: session.email, role: 'tech' } },
          '/api/registrars': { registrars: [{ id: registrarId, name: 'Dynadot', provider: 'dynadot' }] },
          [`/api/registrars/${registrarId}/balance`]: { balance: { amount: 100, currency: 'USD' } },
          '/api/settings': { settings: { defaultRegistrarId: registrarId } },
          '/api/buyers': { buyers: [{ id: 'buyer-test', name: 'KIT' }] },
          '/api/buyer-groups': { groups: [] }, '/api/cloudflare': { accounts: [] },
          '/api/keitaro': { servers: [{ id: 'server-test', name: 'KIT', ipAddress: '192.0.2.1' }] },
          '/api/domains/indexing.example': { domain: { id: 'domain-test', domain: 'indexing.example', status: 'active', registrar: { id: registrarId, name: 'Dynadot' }, purchasePrice: 2.5, currency: 'USD', nameservers: [], cloudflare: null, dns: { records: [] }, keitaro: null, hestia: null, activityLogs: [] } },
          '/api/domains/domain-test/keitaro': { keitaro: { status: 'active' } },
        };
        if (!fixtures[path]) unexpected.push(path);
        call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: fixtures[path] ? 200 : 404, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(fixtures[path] ?? {})).toString('base64') });
      }
    }
  };
  const call = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.result?.exceptionDetails, 'Browser evaluation failed');
    return result.result?.result?.value;
  }
  async function until(expression) {
    for (let i = 0; i < 450; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 200)); }
    throw new Error(`UI timeout: ${expression}`);
  }
  await call('Network.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*api/*', requestStage: 'Request' }] });
  await call('Network.setCookie', { name: 'dm_session', value: session.token, url: base, httpOnly: true });
  await call('Page.navigate', { url: base + '/domain/indexing.example' });
  const click = async text => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Add to Keitaro')`);
  await click('Add to Keitaro');
  const checkbox = `Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes('Allow search engine indexing')).querySelector('input')`;
  await until(`!!Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes('Allow search engine indexing'))`);
  assert.equal(await evaluate(`${checkbox}.checked`), false, 'Indexing defaults off');
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Add'&&!b.disabled)`);
  await click('Add');
  await until(`!Array.from(document.querySelectorAll('label')).some(l=>l.textContent.includes('Allow search engine indexing'))`);
  assert.equal(assignmentCalls[0].allowIndexing, false);
  await click('Add to Keitaro');
  await until(`!!Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes('Allow search engine indexing'))`);
  await evaluate(`${checkbox}.click()`);
  assert.equal(await evaluate(`${checkbox}.checked`), true);
  await click('Add');
  await until(`!Array.from(document.querySelectorAll('label')).some(l=>l.textContent.includes('Allow search engine indexing'))`);
  assert.equal(assignmentCalls[1].allowIndexing, true);
  assert.equal(assignmentCalls[1].serverId, 'server-test');
  await click('Add to Keitaro');
  await until(`!!Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes('Allow search engine indexing'))`);
  assert.equal(await evaluate(`${checkbox}.checked`), false, 'New assignments default off again');
  assert.equal(forbidden.length, 0);
  assert.deepEqual(unexpected, []);
  console.log('PASS: Keitaro indexing defaults off, can be enabled, is sent as a boolean and resets for new assignments. API calls mocked; no remote domains changed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500); });
