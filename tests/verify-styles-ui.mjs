import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const tokens = process.env.TEST_SESSION_FILE ? JSON.parse(fs.readFileSync(process.env.TEST_SESSION_FILE, 'utf8')) : null;
const port = 9265;
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
    return result.result?.result?.value;
  }
  async function until(expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`UI timeout: ${expression}`);
  }
  await call('Network.enable');
  await call('Page.navigate', { url: base + '/login' });
  await until(`!!document.querySelector('form input[type="password"]')`);
  await until(`document.fonts.status === 'loaded'`);
  const cssFiles = await evaluate(`Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(e => e.href)`);
  assert(cssFiles.length, 'Stylesheet is linked');
  for (const url of cssFiles) {
    const response = await fetch(url);
    assert.equal(response.status, 200, 'CSS request succeeds');
    const css = await response.text();
    assert(!css.includes('@theme'), 'Tailwind directives were compiled');
  }
  for (const width of [1440, 390]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    const layout = await evaluate(`(() => {
      const form = document.querySelector('form');
      const card = form.parentElement;
      const wrapper = card.parentElement;
      const rect = card.getBoundingClientRect();
      const button = form.querySelector('button');
      return { display: getComputedStyle(wrapper).display, formDisplay: getComputedStyle(form).display,
        width: rect.width, left: rect.left, viewport: innerWidth,
        inputHeight: document.querySelector('input').getBoundingClientRect().height,
        buttonBackground: getComputedStyle(button).backgroundColor,
        overflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert.equal(layout.display, 'flex', 'Login is centered with flex layout');
    assert.equal(layout.formDisplay, 'grid', 'Login fields use grid spacing');
    assert(layout.width <= 450 && layout.width > 250, 'Card has the intended width');
    assert(Math.abs(layout.left - (layout.viewport - layout.width) / 2) < 2, 'Card is horizontally centered');
    assert(layout.inputHeight >= 32, 'Inputs have usable height');
    assert(!['rgba(0, 0, 0, 0)', 'transparent'].includes(layout.buttonBackground), 'Primary button has a background');
    assert(!layout.overflow, 'No horizontal overflow');
    if (process.env.TEST_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.TEST_SCREENSHOT_DIR, { recursive: true });
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`${process.env.TEST_SCREENSHOT_DIR}/login-${width}.png`, Buffer.from(screenshot.result.data, 'base64'));
    }
  }
  if (tokens) {
    await call('Network.setCookie', { name: 'dm_session', value: tokens.tech.token, url: base, httpOnly: true });
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: base + '/domains/purchased' });
    await until(`!!document.querySelector('aside nav') && document.body.innerText.includes(${JSON.stringify(tokens?.tech?.email)})`);
    const data = await evaluate(`(async () => { const r = await fetch('/api/domains'); const body = await r.json(); return { status: r.status, isList: Array.isArray(body.domains) }; })()`);
    assert.equal(data.status, 200, 'Purchased domain data loads');
    assert(data.isList, 'Purchased domain response is a list');
    await until(`!document.body.innerText.includes('Loading domains...')`);
    const layout = await evaluate(`(() => { const el=document.querySelector('aside');return {display:getComputedStyle(el).display,width:el.getBoundingClientRect().width}; })()`);
    assert.equal(layout.display, 'flex', 'Desktop sidebar is visible');
    assert.equal(layout.width, 240, 'Desktop sidebar has the intended width');
    if (process.env.TEST_SCREENSHOT_DIR) {
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`${process.env.TEST_SCREENSHOT_DIR}/app-desktop.png`, Buffer.from(screenshot.result.data, 'base64'));
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('aside')).display`), 'none', 'Mobile sidebar is hidden');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Open menu"]')).display`), 'block', 'Mobile menu button is visible');
    await evaluate(`document.querySelector('[aria-label="Open menu"]').click()`);
    await until(`!!document.querySelector('[aria-label="Close menu"]')`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('aside')).find(el=>el.getBoundingClientRect().width>0)?.getBoundingClientRect().width`), 256, 'Mobile drawer has the intended width');
  }
  console.log('PASS: compiled CSS, centered login, form spacing, buttons and responsive layout; authenticated sidebar and mobile drawer when a test session is supplied.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill(); });
