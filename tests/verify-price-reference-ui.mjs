import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { SignJWT } from 'jose';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const mocked = process.env.TEST_MOCK_PRICE_REFERENCE === '1';
const session = mocked ? {
  email: 'local-price-test@example.invalid',
  token: await new SignJWT({ id: 'local-test', email: 'local-price-test@example.invalid', role: 'tech' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('local-price-preview-not-production')),
} : JSON.parse(fs.readFileSync(process.env.TEST_SESSION_FILE, 'utf8')).tech;
const registrarId = 'cmuntor0t0001pwggyn3fqcfq';
let chrome, ws;
async function main() {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9275', `--user-data-dir=/private/tmp/bydomen-price-reference-${Date.now()}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:9275/json/list')).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
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
        const price = { domain: 'gutnynin.digital', registration: { amount: 44.59, currency: 'USD' }, estimated: true, promo: false, recentRegistration: { amount: 2.99, currency: 'USD', domain: 'givecho.digital', chargedAt: '2026-10-15T13:03:11.000Z' } };
        const checked = { domain: 'gutnynin.digital', available: true, registrar: 'regway', registrarId, price };
        const balance = { amount: 100, currency: 'USD' };
        const fixtures = {
          '/api/auth/me': { user: { email: session.email, role: 'tech' } },
          '/api/registrars': { registrars: [{ id: registrarId, name: 'Regway', provider: 'regway' }] },
          [`/api/registrars/${registrarId}/balance`]: { balance },
          [`/api/registrars/${registrarId}/tlds`]: { tlds: ['digital'] },
          '/api/settings': { settings: { defaultRegistrarId: registrarId } },
          '/api/buyers': { buyers: [] }, '/api/buyer-groups': { groups: [] },
          '/api/cloudflare': { accounts: [] }, '/api/registrants': { registrants: [] },
          '/api/domains/check': checked,
          '/api/domains/check-bulk': { results: [checked], balance, registrarId },
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
  await call('Fetch.enable', { patterns: [{ urlPattern: mocked ? '*api/*' : '*api/domains/purchase*', requestStage: 'Request' }] });
  await call('Network.setCookie', { name: 'dm_session', value: session.token, url: base, httpOnly: true });
  async function selectRegistrar() {
    await until(`Array.from(document.querySelectorAll('select')).some(s => Array.from(s.options).some(o => o.value === '${registrarId}'))`);
    await evaluate(`(() => { const selects=Array.from(document.querySelectorAll('select')).filter(s=>Array.from(s.options).some(o=>o.value==='${registrarId}')); for (const s of selects) { s.value='${registrarId}'; s.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
  }
  await call('Page.navigate', { url: base + '/domains/search' });
  await selectRegistrar();
  await evaluate(`document.querySelector('input[placeholder="example.com"]').focus()`);
  await call('Input.insertText', { text: 'gutnynin.digital' });
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Check'&&!b.disabled)`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Check').click()`);
  await until(`document.body.innerText.includes('Recent charge:')`);
  let text = await evaluate('document.body.innerText');
  assert(text.includes('$2.99'), 'The real recent charge is visible');
  assert(text.includes('catalog estimate: $44.59'), 'Catalog amount is shown separately');
  assert(text.includes('Oct 2026'), 'The historical charge has a visible date');
  const title = await evaluate(`Array.from(document.querySelectorAll('[title]')).find(e=>e.title.includes('Historical price'))?.title`);
  assert(title?.includes('current registration price is unconfirmed'), 'History is not presented as a guaranteed offer');
  if (process.env.TEST_SCREENSHOT_FILE) {
    const result = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.TEST_SCREENSHOT_FILE, Buffer.from(result.result.data, 'base64'));
  }
  await call('Page.navigate', { url: base + '/domains/purchase' });
  await selectRegistrar();
  await until(`!!document.querySelector('textarea[placeholder="Enter one domain per line..."]')`);
  await evaluate(`document.querySelector('textarea[placeholder="Enter one domain per line..."]').focus()`);
  await call('Input.insertText', { text: 'gutnynin.digital' });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Check Domains').click()`);
  await until(`document.body.innerText.includes('Recent charge:')`);
  text = await evaluate('document.body.innerText');
  assert(text.includes('$2.99'));
  assert(text.includes('Estimated total: $44.59'), 'Historical price does not replace the financial quote');
  assert(text.includes('not a guaranteed offer'), 'The purchase summary explains the price uncertainty');
  assert.equal(forbidden.length, 0, 'No purchase request was attempted');
  assert.deepEqual(unexpected, [], `Unexpected mocked API calls: ${JSON.stringify(unexpected)}`);
  console.log(`PASS${mocked ? ' (mocked API)' : ''}: authenticated search and purchase screens show recent $2.99 with date, keep $44.59 as a separate catalog estimate, and preserve the financial quote. No domains purchased.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); });
