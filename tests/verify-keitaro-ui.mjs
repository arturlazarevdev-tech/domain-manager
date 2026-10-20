import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const fixture = JSON.parse(fs.readFileSync(process.env.TEST_SESSION_FILE, 'utf8'));
const port = 9267;
let chrome, ws, mode = 'partial', intercepted = 0;
const names = new Map();

async function main() {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${port}`,
    `--user-data-dir=/private/tmp/bydomen-keitaro-browser-${Date.now()}`, '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 60; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
    catch { await new Promise(r => setTimeout(r, 200)); }
  }
  assert(tabs, 'Chrome started');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let sequence = 0;
  const pending = new Map();
  const call = (method, params = {}) => new Promise(resolve => {
    const id = ++sequence; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      // Fulfill every bulk assignment locally: browser tests must never modify Keitaro or DNS.
      if (request.method === 'POST') {
        const body = JSON.parse(request.postData);
        const results = body.domainIds.map((id, index) => ({
          id, domain: names.get(id), ok: mode === 'success' || (mode === 'partial' && index === 0),
          error: 'Permission denied (mocked browser test)',
        }));
        intercepted++;
        await call('Fetch.fulfillRequest', { requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ results })).toString('base64'),
        });
      } else await call('Fetch.continueRequest', { requestId });
    }
  };
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.result?.exceptionDetails, 'Browser evaluation failed');
    return result.result?.result?.value;
  }
  async function until(expression) {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`UI timeout: ${expression}`);
  }
  await call('Network.enable');
  await call('Network.setCookie', { name: 'dm_session', value: fixture.tech.token, url: base, httpOnly: true });
  await call('Page.navigate', { url: base + '/domains/purchased' });
  await until(`document.querySelectorAll('tbody input[type="checkbox"]').length >= 2`);
  const domains = await evaluate(`fetch('/api/domains').then(r=>r.json()).then(r=>r.domains.map(d=>({id:d.id,domain:d.domain})))`);
  for (const domain of domains) names.set(domain.id, domain.domain);
  await call('Fetch.enable', { patterns: [{ urlPattern: '*api/domains/bulk/keitaro*', requestStage: 'Request' }] });
  await evaluate(`Array.from(document.querySelectorAll('tbody input[type="checkbox"]')).slice(0,2).forEach(e=>e.click())`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Add selected to Keitaro').click()`);
  await until(`!!Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Add 2 Domains' && !e.disabled)`);
  const submit = async () => {
    await until(`!!Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Add 2 Domains' && !e.disabled)`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Add 2 Domains').click()`);
  };
  await submit();
  await until(`document.body.innerText.includes('1 of 2 domains added to Keitaro; 1 failed')`);
  assert(await evaluate(`!!document.querySelector('[role="alert"]') && document.querySelector('[role="alert"]').textContent.includes('Permission denied')`));
  assert(await evaluate(`!!Array.from(document.querySelectorAll('h2')).find(e=>e.textContent==='Add domain to Keitaro')`), 'Partial failures keep the dialog open');
  mode = 'failed';
  await submit();
  await until(`document.body.innerText.includes('0 of 2 domains added to Keitaro; 2 failed')`);
  assert.equal(await evaluate(`document.querySelector('[role="alert"]').children.length`), 2, 'Every failure is shown');
  mode = 'success';
  await submit();
  await until(`!Array.from(document.querySelectorAll('h2')).some(e=>e.textContent==='Add domain to Keitaro')`);
  await until(`document.body.innerText.includes('2 domains added to Keitaro')`);
  assert.equal(intercepted, 3);
  console.log('PASS: partial/all bulk failures show actual counts and errors; only complete success closes the dialog. All assignment POSTs intercepted; no external writes.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); });
