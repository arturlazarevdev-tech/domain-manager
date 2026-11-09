import assert from "node:assert/strict";
import { HestiaAdapter } from "../src/lib/integrations/hestia/adapter";
const original = globalThis.fetch;
let reply = "{}";
const calls: URLSearchParams[] = [];
globalThis.fetch = (async (_url, init) => {
 const body = new URLSearchParams(init?.body as URLSearchParams);
 assert.equal(body.get("hash"), "access:secret"); calls.push(body);
 return new Response(reply);
}) as typeof fetch;
async function main() {
 const a = new HestiaAdapter("https://panel.example.test", {accessKey:"access",secretKey:"secret",user:"web"});
 assert.deepEqual(await a.testConnection(), {ok:true});
 assert.equal(calls.at(-1)?.get("cmd"), "v-list-web-domains");
 assert.equal(calls.at(-1)?.get("arg1"), "web");
 assert.deepEqual(await a.listUsers(), ["web"]);
 for(const value of ["9", "10", "0", "null", '"denied"', "<html>Login</html>"]) { reply=value; assert.equal((await a.testConnection()).ok,false); }
 reply="0"; await a.addWebDomain("web","example.test","192.0.2.1");
 reply="9"; await assert.rejects(a.addWebDomain("web","example.test","192.0.2.1"));
 reply="4"; await assert.rejects(a.addWebDomain("web","example.test","192.0.2.1"));
 assert.deepEqual(calls.slice(-2).map(c=>c.get("cmd")), ["v-add-web-domain","v-change-web-domain-ip"]);
 console.log("PASS: scoped Hestia authentication, invalid responses and domain operation errors");
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{globalThis.fetch=original;});
