import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { SignJWT } from 'jose';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:33003';
const session = { email: 'suggestions@example.invalid', token: await new SignJWT({ id: 'local-test', role: 'tech' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('local-suggestions-preview-not-production')) };
const registrarId = 'dynadot-local-test';
const profile = `/private/tmp/bydomen-suggestions-ui-${Date.now()}`;
const generateCalls = [];
let chrome, ws;
async function main() {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9283', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:9283/json/list')).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
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
        const balance = { amount: 100, currency: 'USD' };
        if (path === '/api/domains/generate') generateCalls.push(JSON.parse(message.params.request.postData));
        const fixtures = {
          '/api/auth/me': { user: { email: session.email, role: 'tech' } },
          '/api/registrars': { registrars: [{ id: registrarId, name: 'Dynadot', provider: 'dynadot' }, { id: 'regway-test', name: 'Regway', provider: 'regway' }] },
          [`/api/registrars/${registrarId}/balance`]: { balance },
          [`/api/registrars/${registrarId}/tlds`]: { tlds: ['com', 'digital'] },
          '/api/registrars/regway-test/balance': { balance },
          '/api/registrars/regway-test/tlds': { tlds: ['digital'] },
          '/api/settings': { settings: { defaultRegistrarId: registrarId } },
          '/api/buyers': { buyers: [] }, '/api/buyer-groups': { groups: [] },
          '/api/cloudflare': { accounts: [] }, '/api/registrants': { registrants: [] },
          '/api/domains/generate': { available: [{ domain: 'nickelcobalt.digital', available: true, price: { registration: { amount: 2.50, currency: 'USD' } } }], taken: [], generated: 1, timedOut: false },
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
  async function selectRegistrar() {
    await until(`Array.from(document.querySelectorAll('select')).some(s => Array.from(s.options).some(o => o.value === '${registrarId}'))`);
    await evaluate(`(() => { const selects=Array.from(document.querySelectorAll('select')).filter(s=>Array.from(s.options).some(o=>o.value==='${registrarId}')); for (const s of selects) { s.value='${registrarId}'; s.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
  }
  await call('Page.navigate', { url: base + '/domains/purchase' });
  await selectRegistrar();
  const click = async text => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Generate Domains')`);
  await click('Generate Domains');
  await until(`!!document.querySelector('option[value="suggestions"]')`);
  await evaluate(`(() => { const s=document.querySelector('option[value="suggestions"]').parentElement; s.value='suggestions'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`document.body.innerText.includes('Keyword (required)')`);
  assert(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Find available').disabled`));
  await evaluate(`document.querySelector('input[placeholder="e.g. travel, nova, cobalt"]').focus()`);
  await call('Input.insertText', { text: 'cobalt' });
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Find available'&&!b.disabled)`);
  await evaluate(`document.querySelector('input[placeholder="Search zone..."]').focus()`);
  await call('Input.insertText', { text: 'digital' });
  await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='.digital')`);
  await click('.digital');
  await click('Find available');
  await until(`document.body.innerText.includes('nickelcobalt.digital')`);
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0].type, 'suggestions');
  assert.equal(generateCalls[0].registrarId, registrarId);
  assert.equal(generateCalls[0].keyword, 'cobalt');
  assert.equal(generateCalls[0].tld, 'digital');
  assert((await evaluate('document.body.innerText')).includes('$2.50'));
  await click('Use Available Domains');
  await until(`document.querySelector('textarea')?.value==='nickelcobalt.digital'`);
  await evaluate(`(() => { for(const s of Array.from(document.querySelectorAll('select')).filter(s=>Array.from(s.options).some(o=>o.value==='regway-test'))) { s.value='regway-test'; s.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
  await until(`Array.from(document.querySelectorAll('select')).some(s=>s.value==='regway-test')`);
  await click('Generate Domains');
  await until(`document.body.innerText.includes('Find available')`);
  await until(`!document.querySelector('option[value="suggestions"]')`);
  assert.equal(forbidden.length, 0);
  assert.deepEqual(unexpected, []);
  console.log('PASS: Dynadot suggestions mode requires keyword, sends selected account, shows prices, transfers names to purchase form and is hidden for other registrars. All API calls mocked; no purchases.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500); });
