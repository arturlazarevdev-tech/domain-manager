import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const tokens = JSON.parse(fs.readFileSync(process.env.TEST_SESSION_FILE, 'utf8'));
const port = 9261;
let chrome, ws;
async function main() {
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${port}`,
    `--user-data-dir=/private/tmp/bydomen-access-browser-${Date.now()}`, '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 50; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
    catch { await new Promise(r => setTimeout(r, 200)); }
  }
  assert(tabs, 'Chrome started');
  ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const call = (method, params = {}) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.result?.exceptionDetails, 'Browser evaluation failed');
    return result.result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`UI timeout: ${expression}`);
  }
  await call('Network.enable');
  for (const role of ['tech', 'admin']) {
    await call('Network.setCookie', { name: 'dm_session', value: tokens[role].token, url: base, httpOnly: true });
    await call('Page.navigate', { url: base + '/domains/purchase' });
    await until(`document.querySelector('[aria-label="Sign out"]') && document.body.innerText.includes(${JSON.stringify(tokens[role].email)})`);
    await until(`document.querySelector('h1')?.innerText.includes('Buy') || document.querySelector('h1')?.innerText.includes('Purchase')`);
    const links = await evaluate(`Array.from(document.querySelectorAll('nav a')).map(a => a.getAttribute('href'))`);
    assert(links.includes('/domains/purchase'), `${role}: purchase navigation`);
    assert.equal(links.includes('/settings/buyers'), role === 'admin', `${role}: settings menu`);
    assert.equal(links.includes('/infrastructure/cloudflare'), role === 'admin', `${role}: infrastructure menu`);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`document.querySelector('[aria-label="Close menu"]') !== null`);
    const mobileLinks = await evaluate(`Array.from(document.querySelectorAll('.fixed nav a')).map(a => a.getAttribute('href'))`);
    assert.equal(mobileLinks.includes('/settings/buyers'), role === 'admin', `${role}: mobile settings menu`);
    assert.equal(mobileLinks.includes('/infrastructure/cloudflare'), role === 'admin', `${role}: mobile infrastructure menu`);
    await evaluate(`document.querySelector('[aria-label="Close menu"]').click()`);
    await call('Emulation.clearDeviceMetricsOverride');
  }
  console.log('PASS: purchase page opens for both roles; desktop and mobile Infrastructure/Settings menus are admin only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); });
