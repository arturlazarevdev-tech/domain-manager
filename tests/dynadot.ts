import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { DynadotAdapter, dynadotContact } from '../src/lib/integrations/registrars/dynadot/adapter';
import { DynadotClient } from '../src/lib/integrations/registrars/dynadot/client';
import { parseRegistrarCredentials } from '../src/lib/integrations/registrars/credentials';
import { createRegistrarAdapter } from '../src/lib/integrations/registrars/factory';
import { encryptJson } from '../src/lib/crypto';
import { registrarUpsertSchema } from '../src/lib/validators';
import type { RegistrantContact } from '../src/lib/integrations/types';

const originalFetch = globalThis.fetch;
const credentials = { apiKey: 'dynadot-test-key', apiSecret: 'dynadot-test-secret', sandbox: false };
const contact: RegistrantContact = { name: 'Max Smith', email: 'max@example.invalid', country: 'us', state: 'NY', city: 'New York', address: '10 Main Street', zip: '10001', phoneCc: '1', phoneAreaCode: '212', phone: '5551234' };
type Call = { url: URL; method: string; body: Record<string, unknown>; headers: Headers };
const calls: Call[] = [];
let handler: (call: Call) => unknown = () => ({});
const prices = [{ currency: 'USD', unit: '(price/2 year)', registration_price: '20.00' }, { currency: 'EUR', unit: '1 Year', registration_price: '2.00' }, { currency: 'USD', unit: '(price/1 year)', registration_price: '2.99', renewal_price: '49.39', transfer_price: '44.59' }];
function reply(data: unknown) { return Response.json({ code: 200, message: 'Success', data }); }
globalThis.fetch = (async (input, init) => {
 const url = new URL(String(input)), headers = new Headers(init?.headers), raw = String(init?.body || '');
 assert(['api.dynadot.com','api-sandbox.dynadot.com'].includes(url.hostname), 'Tests cannot contact other providers');
 assert.equal(url.searchParams.has('key'), false, 'API credentials stay out of URLs');
 assert.equal(headers.get('Authorization'), 'Bearer '+credentials.apiKey);
 const signature = createHmac('sha256', credentials.apiSecret).update([credentials.apiKey,url.pathname+url.search,headers.get('X-Request-ID'),raw].join('\n')).digest('base64');
 assert.equal(headers.get('X-Signature'),signature,'Sign the exact path, encoded query and serialized body');
 const call = {url,headers,method:init?.method||'GET',body:raw?JSON.parse(raw):{}};
 calls.push(call);
 const result=handler(call);
 return result instanceof Response?result:reply(result);
}) as typeof fetch;

async function main() {
 assert.throws(()=>parseRegistrarCredentials('dynadot',{apiKey:'key'}), /secret/i);
 assert.equal(registrarUpsertSchema.parse({name:'Dynadot',provider:'dynadot',credentials}).provider,'dynadot');
 const a=new DynadotAdapter(credentials);
 handler=()=>({account_info:{balance_list:[{currency:'EUR',amount:'999'},{currency:'USD',amount:'25.50'}]}});
 assert.deepEqual(await a.getBalance(),{amount:25.5,currency:'USD'});
 handler=()=>({account_info:{balance_list:[]}});
 assert.deepEqual(await a.getBalance(),{amount:0,currency:'USD'});
 handler=c=>{assert.equal(c.url.searchParams.get('currency'),'USD');assert.equal(c.url.searchParams.get('show_price'),'true');return {domain_name:'example.digital',available:'Yes',premium:'no',price_list:prices};};
 const checked=await a.checkDomain('EXAMPLE.digital');
 assert.equal(checked.available,true);assert.equal(checked.price?.registration.amount,2.99);assert.equal(checked.price?.renewal?.amount,49.39);
 let batches=0;
 handler=c=>{
  assert.equal(c.url.pathname,'/restful/v2/domains/bulk_search');
  assert.equal(c.url.searchParams.has('timeout'),false,'Standard accounts cannot use the canary timeout parameter');
  const ds=c.url.searchParams.get('domain_name_list')!.split(',');assert(ds.length<=5);batches++;
  return {domain_result_list:ds.filter(d=>d!=='missing.digital').map((domain_name,i)=>({domain_name,available:i?'No':'Yes',price_list:prices,...(domain_name==='busy.digital'?{details_error_message:'busy'}:{})}))};
 };
 const bulk=await a.checkDomains(['A.digital','a.digital','b.digital','c.digital','d.digital','busy.digital','missing.digital']);
 assert.equal(batches,2);assert.equal(bulk.length,6);assert.equal(bulk.find(x=>x.domain==='missing.digital')?.available,false);assert.equal(bulk.find(x=>x.domain==='busy.digital')?.available,false);
 handler=c=>{assert.equal(c.url.pathname,'/restful/v2/domains/get_tld_price');assert.equal(c.url.searchParams.get('sort'),'name_asc');return {tld_price_list:c.url.searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>({tld:`tld${i}`})):[{tld:'digital'},{tld:'co.uk'}]};};
 assert((await a.listTlds()).includes('digital'));
 assert.equal(dynadotContact(contact).phone_number,'2125551234');
 assert.equal(dynadotContact({...contact,phone:'+1 212 5551234'}).phone_number,'2125551234');
 assert.throws(()=>dynadotContact({...contact,phoneCc:''}),/country code/);
 let posts=0;
 handler=c=>{
  if(c.method==='GET')return {domain_name:'example.digital',available:'Yes',premium:'yes',price_list:prices};
  posts++;assert.equal(c.method,'POST');assert.equal(c.body.register_premium,true);assert.equal(c.body.currency,'USD');
  const d=c.body.domain as Record<string,unknown>;assert.equal(d.duration,1);assert.equal(d.privacy,'full','Dynadot requires domain.privacy on registration');assert.deepEqual(d.name_server_list,['beth.ns.cloudflare.com','koa.ns.cloudflare.com']);
  for(const key of ['registrant_contact','admin_contact','tech_contact','billing_contact']){
   assert.deepEqual(d[key],JSON.parse(JSON.stringify(dynadotContact(contact))));
   for(const field of ['name','email','phone_number','phone_cc','address1','city','zip','country'])assert((d[key] as Record<string,unknown>)[field],`Required contact field: ${key}.${field}`);
  }
  return {domain_name:'example.digital',expiration_date:'1824019200000'};
 };
 const bought=await a.registerDomain({domain:'example.digital',contact,nameservers:['beth.ns.cloudflare.com','koa.ns.cloudflare.com']});
 assert.equal(posts,1);assert.equal(bought.registrationStatus,'purchased');assert(bought.expiresAt);assert.equal(bought.price,undefined,'Do not label a quote as the actual charge');
 handler=c=>{assert.equal(c.method,'PUT');assert.deepEqual(c.body.nameserver_list,['beth.ns.cloudflare.com','koa.ns.cloudflare.com']);return Response.json({code:200,message:'Success'});};
 await a.setNameservers('example.digital',['BETH.ns.cloudflare.com','koa.ns.cloudflare.com','beth.ns.cloudflare.com']);
 await assert.rejects(a.setNameservers('example.digital',[]),/two/);await assert.rejects(a.setNameservers('example.digital',['one.example']),/two/);
 let nsAttempts=0;
 const registrationsBefore=calls.filter(c=>c.method==='POST'&&c.url.pathname.endsWith('/register')).length;
 handler=c=>{
  assert.equal(c.method,'PUT');assert.equal(c.url.pathname,'/restful/v2/domains/new.digital/nameservers');
  assert.deepEqual(c.body.nameserver_list,['beth.ns.cloudflare.com','koa.ns.cloudflare.com']);
  nsAttempts++;
  return nsAttempts===1?Response.json({code:404,error:{description:'Can not find the new.digital in the account.'}},{status:404}):Response.json({code:200,message:'Success'});
 };
 await a.setNameservers('new.digital',['beth.ns.cloudflare.com','koa.ns.cloudflare.com']);
 assert.equal(nsAttempts,2,'Retry the nameserver update while a newly registered domain becomes visible');
 assert.equal(calls.filter(c=>c.method==='POST'&&c.url.pathname.endsWith('/register')).length,registrationsBefore,'Never register again when retrying nameservers');
 nsAttempts=0;
 handler=()=>{nsAttempts++;return Response.json({code:403,error:{description:'The domain is not allowed to change nameservers.'}},{status:403});};
 await assert.rejects(a.setNameservers('new.digital',['beth.ns.cloudflare.com','koa.ns.cloudflare.com']),/not allowed/);
 assert.equal(nsAttempts,1,'Permanent errors are not retried');
 handler=c=>c.url.pathname.endsWith('/nameservers')?{nameserver_list:[{server_name:'beth.ns.cloudflare.com'},{server_name:'koa.ns.cloudflare.com'}]}:{domain_info:{domain_name:'example.digital',registration_date:1792483200000,expiration_date:1824019200000,status:'active'}};
 const info=await a.getDomain('example.digital');assert.equal(info.registeredAt?.getUTCFullYear(),2026);assert.equal(info.nameservers?.length,2);
 handler=c=>({domain_info_list:[{domain_name:c.url.searchParams.get('page')==='1'?'first.digital':'second.digital'}],pagination_result:{has_next_page:c.url.searchParams.get('page')==='1'?'Yes':'No'}});
 assert.equal((await a.listDomains()).length,2);
 handler=()=>({domain_name:'example.digital',available:'Yes',price_list:[prices[0]]});
 await assert.rejects(a.getPrice('example.digital'),/One-year/);
 handler=()=>Response.json({code:401,error:{description:`Rejected ${credentials.apiKey} ${credentials.apiSecret}`}}, {status:401});
 await assert.rejects(a.getBalance(),e=>e instanceof Error&&!e.message.includes(credentials.apiKey)&&!e.message.includes(credentials.apiSecret)&&e.message.includes('[redacted]'));
 let attempts=0;
 handler=()=>{attempts++;throw new TypeError('Network interrupted')};
 const client=new DynadotClient(credentials);
 await assert.rejects(client.request('/domains/example.digital/register','POST',{}),/Check the domain and order/);assert.equal(attempts,1,'Uncertain purchases are never replayed');
 handler=c=>{assert.equal(c.url.hostname,'api-sandbox.dynadot.com');return {account_info:{balance_list:[]}};};
 assert((await new DynadotAdapter({...credentials,sandbox:true}).testConnection()).ok);
 loadEnvConfig(process.cwd());
 const fromFactory=createRegistrarAdapter({provider:'dynadot',credentialsEncrypted:encryptJson(credentials),defaultNameservers:[]});assert.equal(fromFactory.provider,'dynadot');
 console.log('PASS: Dynadot signed REST v2 requests, secret redaction, sandbox, balances, one-year account prices, availability/bulk limits, full TLD pagination, profile contacts, registration without replay, nameservers, domain lists and factory. All provider calls mocked; no domains purchased.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{globalThis.fetch=originalFetch});
