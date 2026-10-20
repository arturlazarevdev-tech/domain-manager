import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { CloudflareAdapter } from "../src/lib/integrations/cloudflare/adapter";
import { isCloudflareZoneLimit } from "../src/lib/integrations/cloudflare/limits";
import { AppError } from "../src/lib/errors";
import { prisma } from "../src/lib/db";
import { encryptJson } from "../src/lib/crypto";
import { RegwayAdapter } from "../src/lib/integrations/registrars/regway/adapter";
import { startPurchase, processPurchaseJob } from "../src/lib/services/purchase";
import type { JobProgress } from "../src/lib/jobs/types";

loadEnvConfig(process.cwd());
const originalFetch = globalThis.fetch;
const originalRegistrar = {
  getBalance: RegwayAdapter.prototype.getBalance,
  checkDomain: RegwayAdapter.prototype.checkDomain,
  getPrice: RegwayAdapter.prototype.getPrice,
  registerDomain: RegwayAdapter.prototype.registerDomain,
};
let total = 10, active = 10, pending = 0;
let malformed = false, responseStatus = 400;
let registrations = 0, creationAttempts = 0;
const tag = crypto.randomUUID();
const names = [`first-${tag}.example`, `second-${tag}.example`];
let registrarId: string, cfId: string, buyerId: string, profileId: string, jobId: string;

globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, "api.cloudflare.com", "No real external API is allowed in this test");
  if ((init?.method ?? "GET") === "GET" && url.pathname.endsWith("/zones")) {
    if (url.searchParams.has("name")) return Response.json({ success: true, result: [] });
    return Response.json({ success: true, result: [], result_info: malformed ? {} : {
      total_count: url.searchParams.get("status") === "active" ? active : url.searchParams.get("status") === "pending" ? pending : total,
    } });
  }
  if (init?.method === "POST" && url.pathname.endsWith("/zones")) {
    creationAttempts++;
    return Response.json({ success: false, errors: [{ message: "You have exceeded the limit for adding zones. Please activate some zones." }] }, { status: responseStatus });
  }
  throw new Error(`Unexpected external call blocked: ${init?.method} ${url.pathname}`);
}) as typeof fetch;

async function main() {
  const adapter = new CloudflareAdapter({ apiToken: "test", accountId: "a".repeat(32) });
  await adapter.assertZoneCapacity();
  total = 51; active = 10; pending = 41;
  await assert.rejects(adapter.assertZoneCapacity(), isCloudflareZoneLimit);
  total = 50; active = 10; pending = 40;
  await adapter.assertZoneCapacity();
  total = 60; active = 35; pending = 25;
  await adapter.assertZoneCapacity();
  malformed = true;
  await assert.rejects(adapter.assertZoneCapacity(), /Could not verify/);
  malformed = false;
  for (responseStatus of [400, 429]) await assert.rejects(adapter.createZone(names[0]), isCloudflareZoneLimit);
  assert(!isCloudflareZoneLimit(new Error("limit for adding zones")));
  assert(!isCloudflareZoneLimit(new AppError({ message: "Registrar failed", provider: "regway" })));

  registrarId = (await prisma.registrarAccount.create({ data: {
    name: tag, provider: "regway", credentialsEncrypted: encryptJson({ authUserId: "test", apiKey: "test" }),
  } })).id;
  cfId = (await prisma.cloudflareAccount.create({ data: {
    name: tag, accountId: "a".repeat(32), credentialsEncrypted: encryptJson({ apiToken: "test", accountId: "a".repeat(32) }),
  } })).id;
  buyerId = (await prisma.buyer.create({ data: { name: tag } })).id;
  profileId = (await prisma.registrantProfile.create({ data: {
    name: tag, registrarId, email: "test@example.invalid", phone: "5551234567", country: "US", state: "CA", city: "Test", address: "1 Test St", zip: "90001",
  } })).id;
  const input = { domains: names, registrarId, cloudflareAccountId: cfId, buyerId, registrantId: profileId };
  total = 51; active = 10; pending = 41;
  await assert.rejects(startPurchase(input), isCloudflareZoneLimit);
  assert.equal(await prisma.domainPurchase.count({ where: { domainName: { in: names } } }), 0, "blocked before queuing or creating purchase locks");

  total = 10; active = 10; pending = 0;
  RegwayAdapter.prototype.getBalance = async () => ({ amount: 5, currency: "USD" });
  RegwayAdapter.prototype.checkDomain = async (domain) => ({ domain, available: true });
  RegwayAdapter.prototype.getPrice = async (domain) => ({ domain, estimated: true, registration: { amount: 44.59, currency: "USD" } });
  RegwayAdapter.prototype.registerDomain = async ({ domain }) => { registrations++; return { domain, registrationStatus: "purchased", price: { amount: 2.99, currency: "USD" } }; };
  const batchId = crypto.randomUUID();
  const job = await prisma.job.create({ data: {
    type: "purchase", payload: { ...input, batchId, idempotencyKey: batchId },
    progress: { total: 2, completed: 0, items: names.map(domain => ({ domain, status: "queued" })) },
  } });
  jobId = job.id;
  for (const name of names) await prisma.domainPurchase.create({ data: {
    batchId, idempotencyKey: `purchase:${name}`, domainName: name, registrarId, buyerId, priceAmount: 1, currency: "USD", jobId, status: "queued",
  } });
  creationAttempts = 0;
  await processPurchaseJob(jobId);
  assert.equal(registrations, 1, "a zone limit prevents the next registrar purchase");
  assert.equal(creationAttempts, 1);
  const progress = (await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).progress as JobProgress;
  assert.equal(progress.items[0].status, "purchased", "a Cloudflare failure must preserve successful registration");
  assert.equal(progress.items[0].price, 2.99, "progress reflects the actual charge rather than the catalog quote");
  assert.equal(Number((await prisma.domain.findUniqueOrThrow({ where: { domain: names[0] } })).purchasePrice), 2.99);
  assert.equal(Number((await prisma.domainPurchase.findUniqueOrThrow({ where: { idempotencyKey: `purchase:${names[0]}` } })).priceAmount), 2.99);
  assert.equal(progress.items[1].status, "failed");
  assert.match(progress.items[1].error!, /Not purchased/);
  assert.equal(await prisma.domain.count({ where: { domain: names[1] } }), 0);
  await assert.rejects(startPurchase({ ...input, domains: [`next-${tag}.example`] }), isCloudflareZoneLimit);
  console.log("PASS: live capacity, boundaries, malformed responses, provider limit errors, pre-purchase rejection, recent-limit cooldown, and stopping a batch without losing purchased domains. All external APIs mocked.");
}

main().finally(async () => {
  globalThis.fetch = originalFetch;
  Object.assign(RegwayAdapter.prototype, originalRegistrar);
  await prisma.purchaseLock.deleteMany({ where: { domainName: { in: names } } });
  await prisma.domainPurchase.deleteMany({ where: { domainName: { in: names } } });
  await prisma.domain.deleteMany({ where: { domain: { in: names } } });
  if (jobId) { await prisma.activityLog.deleteMany({ where: { jobId } }); await prisma.job.delete({ where: { id: jobId } }); }
  if (profileId) await prisma.registrantProfile.delete({ where: { id: profileId } });
  if (cfId) await prisma.cloudflareAccount.delete({ where: { id: cfId } });
  if (buyerId) await prisma.buyer.delete({ where: { id: buyerId } });
  if (registrarId) await prisma.registrarAccount.delete({ where: { id: registrarId } });
  await prisma.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
