import assert from "node:assert/strict";
import { mock } from "node:test";
import { prisma } from "../src/lib/db";
import { encryptJson } from "../src/lib/crypto";
import { deployDomainToServer } from "../src/lib/services/hosting";
import { HestiaAdapter } from "../src/lib/integrations/hestia/adapter";
import { CloudflareAdapter } from "../src/lib/integrations/cloudflare/adapter";
process.env.ENCRYPTION_KEY="12".repeat(32);
const server={id:"server",name:"Hosting",enabled:true,ipAddress:"192.0.2.1",username:"web",url:"https://panel.example.test",credentialsEncrypted:encryptJson({accessKey:"test",secretKey:"test"})};
let enabled=true,status="purchased",fail=false;
let zone: {zoneId:string;accountId:string;status:string}|null={zoneId:"zone",accountId:"cf",status:"active"};
const calls:string[]=[];
const restore:Array<()=>void>=[];
function stub(target:object,key:string,value:unknown){const previous=Reflect.get(target,key);Reflect.set(target,key,value);restore.push(()=>{Reflect.set(target,key,previous);});}
stub(prisma.hestiaServer,"findFirst",async()=>enabled?server:null);
stub(prisma.hestiaServer,"findUnique",async()=>server);
stub(prisma.domain,"findUnique",async()=>({id:"domain",domain:"example.test",status,cloudflare:zone}));
stub(prisma.cloudflareAccount,"findUnique",async()=>({enabled:true,credentialsEncrypted:encryptJson({apiToken:"test",accountId:"test"})}));
stub(prisma.domainHestia,"upsert",async()=>({id:"hosting"}));
stub(prisma.domainHestia,"update",async(args:{data:{status:string}})=>{calls.push(args.data.status);return {};});
stub(prisma.domainHestia,"findUnique",async()=>({status:"active"}));
stub(prisma.appSettings,"findUnique",async()=>null);
for(const name of ["deleteMany","createMany","findMany"])stub(prisma.domainDnsRecord,name,async()=>[]);
stub(prisma.activityLog,"create",async()=>({}));
mock.method(HestiaAdapter.prototype,"addWebDomain",async(user:string,domain:string,ip:string)=>{assert.deepEqual([user,domain,ip],["web","example.test","192.0.2.1"]);calls.push("website");if(fail)throw new Error("Hosting unavailable");return {name:domain,user,ip};});
mock.method(CloudflareAdapter.prototype,"createZone",async()=>{throw new Error("Existing zone must be preserved");});
mock.method(CloudflareAdapter.prototype,"listDnsRecords",async()=>[]);
mock.method(CloudflareAdapter.prototype,"upsertDnsRecord",async(_zone:string,record:{name:string;content:string})=>{assert.equal(record.content,"192.0.2.1");calls.push(record.name);return {id:"dns",...record};});
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error("External request forbidden in test");};
async function main(){
 enabled=false;await assert.rejects(deployDomainToServer("domain",{serverId:"server"}),/disabled/);enabled=true;
 status="pending";await assert.rejects(deployDomainToServer("domain",{serverId:"server"}),/registered/);status="purchased";
 zone=null;await assert.rejects(deployDomainToServer("domain",{serverId:"server"}),/Cloudflare/);assert.deepEqual(calls,[]);
 zone={zoneId:"zone",accountId:"cf",status:"active"};await deployDomainToServer("domain",{serverId:"server",cloudflareAccountId:"other"});assert.deepEqual(calls,["website","example.test","www.example.test","active"]);
 calls.length=0;fail=true;await assert.rejects(deployDomainToServer("domain",{serverId:"server"}),/Hosting unavailable/);assert.deepEqual(calls,["website","failed"]);
 console.log("PASS: hosting prerequisites, existing zone preservation, DNS and partial failures");
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{mock.restoreAll();restore.forEach(f=>f());globalThis.fetch=originalFetch;await prisma.$disconnect();});
