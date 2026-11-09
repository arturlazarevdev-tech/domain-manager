import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const tokens = JSON.parse(fs.readFileSync(process.env.TEST_SESSION_FILE, 'utf8'));
const port = 9263;
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
    await call('Page.navigate', { url: base + '/servers' });
    await until(`document.querySelector('h1')?.innerText === 'Servers' && document.body.innerText.includes(${JSON.stringify(tokens[role].email)})`);
    await until(`document.body.innerText.includes('KIT TEAM') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Add domains' && !b.disabled)`);
    const card = await evaluate(`(() => { const card=document.querySelector('[data-server-card]'); const badge=card?.querySelector('.rounded-full'); return { badgeHeight:badge?.getBoundingClientRect().height, domainLinks:card?.querySelectorAll('a[href^="/domain/"]').length, text:card?.innerText }; })()`);
    assert(card.badgeHeight > 0 && card.badgeHeight <= 24, `${role}: compact connection status`);
    assert.equal(card.domainLinks, 0, `${role}: no domain list in server card`);
    assert(/\d+ domains?/.test(card.text), `${role}: domain count`);
    const links = await evaluate(`Array.from(document.querySelectorAll('nav a')).map(a=>a.getAttribute('href'))`);
    assert(links.includes('/servers'), `${role}: Servers navigation`);
    assert.equal(await evaluate(`document.querySelector('nav a[href="/servers"]').closest('nav > div')?.firstElementChild?.textContent`), 'Infrastructure', `${role}: Servers is grouped under Infrastructure`);
    assert.equal(await evaluate(`document.body.innerText.includes('Manage servers')`), role === 'admin', `${role}: manage connections link`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Add domains').click()`);
    await until(`document.querySelector('.relative.z-10 input[type="checkbox"]') !== null`);
    await evaluate(`document.querySelector('.relative.z-10 input[type="checkbox"]').click()`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Continue').click()`);
    await until(`Array.from(document.querySelectorAll('h2')).some(h=>h.textContent==='Add domains to server')`);
    assert(await evaluate(`Boolean(document.querySelector('.relative.z-10 select[disabled]')?.value)`), `${role}: selected destination server`);
    assert.equal(await evaluate(`document.querySelectorAll('.relative.z-10 select').length`), 2, `${role}: server and Cloudflare selection`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cancel').click()`);
    if (role === 'admin') {
      await call('Page.navigate', { url: base + '/settings/servers' });
      await until(`Array.from(document.querySelectorAll('h2')).some(h=>h.textContent==='Web servers') && document.body.innerText.includes('KIT TEAM')`);
      const connectionCard = await evaluate(`(() => { const grid=Array.from(document.querySelectorAll('h2')).find(h=>h.textContent==='Web servers').parentElement.nextElementSibling; return grid.innerText; })()`);
      assert(!connectionCard.includes('https://'), 'Technical API URL is hidden in settings overview');
      assert(!connectionCard.includes('Username'), 'Credentials are hidden in settings overview');
      await evaluate(`(() => { const grid=Array.from(document.querySelectorAll('h2')).find(h=>h.textContent==='Web servers').parentElement.nextElementSibling; Array.from(grid.querySelectorAll('button')).find(b=>b.textContent==='Edit').click(); })()`);
      await until(`Array.from(document.querySelectorAll('label')).some(l=>l.textContent.includes('Panel API URL'))`);
      assert(await evaluate(`Boolean(Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes('Panel API URL')).querySelector('input').value)`), 'API connection remains available in Edit');
      await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cancel').click()`);
      await call('Page.navigate', { url: base + '/servers' });
      await until(`document.querySelector('h1')?.innerText === 'Servers' && document.body.innerText.includes(${JSON.stringify(tokens[role].email)}) && document.querySelector('[data-server-card]') !== null`);
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`document.querySelector('.fixed nav a[href="/servers"]') !== null`);
    await evaluate(`document.querySelector('[aria-label="Close menu"]').click()`);
    await call('Emulation.clearDeviceMetricsOverride');
  }
  console.log('PASS: admin/tech server list, navigation, domain selection, preselected destination, DNS account and mobile menu; no deployment submitted.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); });
