import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { KeitaroAdapter, keitaroCredentialsSchema } from "../src/lib/integrations/keitaro/adapter";

const dir = mkdtempSync(join(tmpdir(), "bydomen-keitaro-tls-"));
for (const name of ["server", "wrong"]) execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${name}-without-ip-san`, "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.crt`)], { stdio: "pipe" });
const certificate = readFileSync(join(dir, "server.crt"), "utf8");
let requests = 0, cleartextRequests = 0, redirect = false;
const cleartext = createHttpServer((_req, res) => { cleartextRequests++; res.end("Should never be contacted"); });
const server = createServer({ key: readFileSync(join(dir, "server.key")), cert: certificate }, (req, res) => {
  requests++;
  assert.equal(req.headers["api-key"], "fixture-key");
  if (redirect) { res.writeHead(302, { Location: `http://127.0.0.1:${(cleartext.address() as AddressInfo).port}/` }); res.end(); }
  else { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify([{ id: 1, name: "fixture.example", state: "active" }])); }
});
server.on("tlsClientError", () => {});

async function main() {
  await new Promise<void>(resolve => cleartext.listen(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal(keitaroCredentialsSchema.safeParse({ apiKey: "fixture-key", tlsCertificate: certificate }).success, false);
  const adapter = new KeitaroAdapter(origin, { apiKey: "fixture-key", tlsCertificate: certificate, tlsOrigin: origin });
  assert.equal((await adapter.listDomains())[0].name, "fixture.example", "An exact certificate pin supports legacy certificates without IP SANs");
  assert.equal((await adapter.testConnection()).ok, true);
  const before = requests;
  const wrong = new KeitaroAdapter(origin, { apiKey: "fixture-key", tlsCertificate: readFileSync(join(dir, "wrong.crt"), "utf8"), tlsOrigin: origin });
  assert.equal((await wrong.testConnection()).ok, false, "Untrusted certificates must fail");
  const changedOrigin = new KeitaroAdapter(origin, { apiKey: "fixture-key", tlsCertificate: certificate, tlsOrigin: "https://other.invalid" });
  assert.equal((await changedOrigin.testConnection()).ok, false);
  const downgrade = new KeitaroAdapter(origin.replace("https:", "http:"), { apiKey: "fixture-key", tlsCertificate: certificate, tlsOrigin: origin });
  assert.equal((await downgrade.testConnection()).ok, false, "Pinned connections cannot downgrade to HTTP");
  assert.equal(requests, before, "Failed identity checks must never transmit API credentials");
  redirect = true;
  assert.equal((await adapter.testConnection()).ok, false, "API redirects must not be followed");
  assert.equal(cleartextRequests, 0, "API keys must never be forwarded to plaintext endpoints");
  console.log("PASS: pinned HTTPS, legacy IP certificate, wrong-certificate rejection, origin binding, HTTP downgrade rejection, and redirect credential protection.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => cleartext.close(() => resolve()))]);
  rmSync(dir, { recursive: true, force: true });
});
