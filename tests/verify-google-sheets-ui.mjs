import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3001';
let user, chrome, ws;
const pending = new Map(); let sequence = 0;
async function main() {
  user = await db.user.create({ data: { email: `sheets-ui-${crypto.randomUUID()}@example.invalid`, passwordHash: 'test-only', role: 'admin' } });
  const token = await new SignJWT({ id: user.id, email: user.email, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=9267', `--user-data-dir=/private/tmp/bydomen-sheets-ui-${Date.now()}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i=0;i<50;i++) { try { tabs = await (await fetch('http://127.0.0.1:9267/json/list')).json(); break; } catch { await new Promise(r=>setTimeout(r,200)); } }
  assert(tabs);
  ws = new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  ws.onmessage = e => { const m=JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const call = (method,params={}) => new Promise(resolve=> { const id=++sequence; pending.set(id,resolve); ws.send(JSON.stringify({id,method,params})); });
  async function evaluate(expression) { const r=await call('Runtime.evaluate',{expression,returnByValue:true}); assert(!r.result?.exceptionDetails); return r.result.result.value; }
  await call('Network.enable');
  await call('Network.setCookie',{name:'dm_session',value:token,url:base,httpOnly:true});
  await call('Page.navigate',{url:base+'/settings/google-sheets'});
  for(let i=0;i<80;i++) { if(await evaluate(`document.querySelector('h1')?.textContent === 'Google Sheets' && Boolean(document.querySelector('textarea'))`)) break; await new Promise(r=>setTimeout(r,200)); }
  assert(await evaluate(`document.body.innerText.includes('Как подключить')`));
  assert(await evaluate(`document.body.innerText.includes('09:00') && document.body.innerText.includes('по Киеву')`));
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'');
  assert(await evaluate(`Boolean(document.querySelector('nav a[href="/settings/google-sheets"]'))`));
  assert(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Отправить за прошлую неделю').disabled`));
  for (const width of [1440,390]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
    assert(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`), `${width}px: no horizontal overflow`);
  }
  console.log('PASS: Google Sheets settings page, setup instructions, schedule, empty key field, disabled delivery before setup, desktop/mobile layout.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{ws?.close();chrome?.kill();if(user)await db.user.delete({where:{id:user.id}});await db.$disconnect();});
