import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const base=process.env.TEST_BASE_URL||'http://localhost:3000';
const session=JSON.parse(fs.readFileSync(process.env.TEST_SESSION_FILE,'utf8')).admin;
const profile=`/private/tmp/bydomen-dynadot-ui-${Date.now()}`;
let chrome,ws;
try{
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=9281',`--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'],{stdio:'ignore'});
 let tabs;
 for(let i=0;i<80;i++){try{tabs=await(await fetch('http://127.0.0.1:9281/json/list')).json();break}catch{await new Promise(r=>setTimeout(r,200))}}
 assert(tabs,'Chrome started');
 ws=new WebSocket(tabs.find(x=>x.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map();const blocked=[];
 const call=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}))});
 ws.onmessage=event=>{
  const m=JSON.parse(event.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}
  if(m.method==='Fetch.requestPaused'){
   if(m.params.request.method!=='GET'){blocked.push(m.params.request.url);call('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Aborted'})}
   else call('Fetch.continueRequest',{requestId:m.params.requestId});
  }
 };
 async function evaluate(expression){const m=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!m.result?.exceptionDetails,'Browser evaluation failed');return m.result?.result?.value}
 async function until(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200))}throw Error('UI timeout: '+expression+'; '+JSON.stringify(await evaluate('({url:location.href,text:document.body.innerText.slice(0,2000)})')))}
 await call('Network.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*api/*',requestStage:'Request'}]});
 await call('Network.setCookie',{name:'dm_session',value:session.token,url:base,httpOnly:true});
 await call('Page.navigate',{url:base+'/settings/registrars'});
 await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Add')`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Add').click()`);
 await until(`!!document.querySelector('option[value="dynadot"]')`);
 async function choose(provider){await evaluate(`(()=>{const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='dynadot'));s.value=${JSON.stringify(provider)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
 await choose('dynadot');
 await until(`!!document.querySelector('input[placeholder="Dynadot API secret"]')`);
 assert.equal(await evaluate(`document.body.innerText.includes('Reseller ID')`),false);
 assert.equal(await evaluate(`!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save')?.disabled`),true);
 await evaluate(`document.querySelector('input[placeholder="Dynadot API key"]').focus()`);await call('Input.insertText',{text:'ui-only-fake-key'});
 assert.equal(await evaluate(`!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save')?.disabled`),true);
 await evaluate(`document.querySelector('input[placeholder="Dynadot API secret"]').focus()`);await call('Input.insertText',{text:'ui-only-fake-secret'});
 await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Save'&&!b.disabled)`);
 assert.equal(await evaluate(`document.querySelector('input[placeholder="Dynadot API secret"]').type`),'password');
 await choose('openprovider');await until(`!!document.querySelector('input[placeholder="Openprovider username"]')`);
 await choose('regway');await until(`document.body.innerText.includes('Reseller ID')`);
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Cancel').click()`);
 assert.deepEqual(blocked,[],'No writes or purchases attempted by UI validation');
 console.log('PASS: live registrar settings offer Dynadot, require and mask both credentials, and preserve Regway/Openprovider forms. No configuration submitted and no purchases attempted.');
}finally{
 ws?.close();
 if(chrome){chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,600))}
 fs.rmSync(profile,{recursive:true,force:true});
}
