import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { SignJWT } from 'jose';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:33005';
const session = { email: 'suggestions@example.invalid', token: await new SignJWT({ id: 'local-test', role: 'tech' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('local-report-preview-not-production')) };
const registrarId = 'dynadot-local-test';
const profile = `/private/tmp/bydomen-report-ui-${Date.now()}`;

let chrome, ws;
async function main() {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9285', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:9285/json/list')).json(); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
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
        const registrar = { id: registrarId, name: 'Dynadot' }, other = { id: 'r2', name: 'Openprovider' };
        const buyer = { id: 'b1', name: 'Alex' }, team = { id: 'g1', name: 'KIT' };
        const row = { purchasedAt: '2026-10-21T08:00:00Z', currency: 'USD', status: 'active', dns: { ip: null }, cloudflare: null, server: null, group: null, registrar, buyer, buyerGroup: team };
        const fixtures = {
          '/api/auth/me': { user: { email: session.email, role: 'tech' } },
          '/api/registrars': { registrars: [{ ...registrar, provider: 'dynadot' }, { ...other, provider: 'openprovider' }] },
          [`/api/registrars/${registrarId}/balance`]: { balance: { amount: 100, currency: 'USD' } },
          '/api/settings': { settings: { defaultRegistrarId: registrarId } },
          '/api/buyers': { buyers: [buyer, { id: 'b2', name: 'Kate' }] },
          '/api/buyer-groups': { groups: [team] }, '/api/cloudflare': { accounts: [] },
          '/api/domains': { domains: [
            { ...row, id: 'd1', domain: 'one.digital', purchasePrice: 2.5 },
            { ...row, id: 'd2', domain: 'two.digital', registrar: other, purchasePrice: 3.99 },
            { ...row, id: 'd3', domain: 'three.digital', buyer: { id: 'b2', name: 'Kate' }, purchasePrice: 1.25 },
            { ...row, id: 'd4', domain: 'direct.digital', buyer: null, purchasePrice: 2 },
          ] },
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
  await call('Page.navigate', { url: base + '/domains/purchased' });
  const report = `document.querySelector('section[aria-label="Spending report"]')`;
  await until(`${report}?.innerText.includes('$9.74')`);
  const text = await evaluate(`${report}.innerText`);
  assert(text.includes('Dynadot') && text.includes('Openprovider') && text.includes('Alex') && text.includes('Kate') && text.includes('Group needs'));
  assert(text.includes('$5.75') && text.includes('$3.99'), 'Registrar subtotals are shown');
  const toggle = async label => evaluate(`${report}.querySelectorAll('label')[${JSON.stringify({ Registrar: 0, 'Buyer group': 1, Buyer: 2 }[label])}].querySelector('input').click()`);
  await toggle('Registrar');
  await until(`${report}.innerText.includes('$6.49')`);
  assert((await evaluate(`${report}.innerText`)).includes('Buyer group: KIT'));
  await toggle('Buyer group');
  await until(`!${report}.innerText.includes('Buyer group: KIT')`);
  assert((await evaluate(`${report}.innerText`)).includes('Buyer: Alex'));
  await toggle('Buyer');
  await until(`${report}.querySelectorAll('tbody tr').length===0`);
  assert((await evaluate(`${report}.innerText`)).includes('$9.74'));
  await toggle('Registrar');
  await until(`${report}.innerText.includes('$5.75')`);
  await evaluate(`(() => { const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='b1'));s.value='b1';s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await until(`${report}.innerText.includes('$6.49')&&!${report}.innerText.includes('$5.75')`);
  await evaluate(`(() => { URL.createObjectURL=blob=>{window.__reportBlob=blob;return 'blob:local-report-test';};HTMLAnchorElement.prototype.click=function(){};Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Export CSV').click(); })()`);
  const csv = await evaluate('window.__reportBlob.text()');
  assert(csv.includes('"Grouped spending report"'));
  assert(csv.includes('"6.49","USD"'));
  assert(csv.includes('"Registrar","Dynadot","","1","2.50","USD"'));
  assert(csv.includes('"one.digital"') && csv.includes('"two.digital"'));
  assert(!csv.includes('"three.digital"') && !csv.includes('"direct.digital"'), 'CSV respects buyer filter');
  assert.equal(forbidden.length, 0);
  assert.deepEqual(unexpected, []);
  console.log('PASS: hierarchical spending report, independent grouping controls, registrar and buyer totals, filters, grand totals and grouped CSV export. All API calls mocked.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500); });
