import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { deleteSettingInTransaction } from "../src/lib/services/delete-settings";
import { getSpending } from "../src/lib/services/spending";
import { serializeDomain } from "../src/lib/serializers";
import { managedDomainInclude } from "../src/lib/services/domain-management";

const rollback = new Error("Roll back fixtures");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Remote requests forbidden"); };
async function main() {
  try {
    await prisma.$transaction(async tx => {
      const tag = crypto.randomUUID();
      const group = await tx.buyerGroup.create({ data: { name: `Deletion ${tag}` } });
      const buyer = await tx.buyer.create({ data: { name: `Buyer ${tag}`, groupId: group.id, isDefault: true } });
      const registrar = await tx.registrarAccount.create({ data: { name: `Registrar ${tag}`, provider: "regway", credentialsEncrypted: "test" } });
      const cloudflare = await tx.cloudflareAccount.create({ data: { name: `Cloudflare ${tag}`, accountId: tag, credentialsEncrypted: "test" } });
      const keitaro = await tx.keitaroServer.create({ data: { name: `Keitaro ${tag}`, url: "https://example.test", credentialsEncrypted: "test" } });
      const hestia = await tx.hestiaServer.create({ data: { name: `Hosting ${tag}`, url: "https://example.test", username: "web", credentialsEncrypted: "test" } });
      const profile = await tx.registrantProfile.create({ data: { name: tag, email: "test@example.test", phone: "123", country: "US", state: "", city: "", address: "", zip: "", isDefault: true, registrarId: registrar.id } });
      const domain = await tx.domain.create({ data: { domain: `${tag}.example`, tld: "example", registrarId: registrar.id, buyerId: buyer.id, purchasePrice: 12.34, currency: "USD", registeredAt: new Date(), status: "purchased",
        cloudflare: { create: { accountId: cloudflare.id, zoneId: tag, status: "active" } },
        keitaro: { create: { serverId: keitaro.id, serverIp: "192.0.2.1", status: "active" } },
        hestia: { create: { serverId: hestia.id, webUser: "web", ip: "192.0.2.2", status: "active" } },
        purchases: { create: { batchId: tag, idempotencyKey: tag, domainName: `${tag}.example`, registrarId: registrar.id, buyerId: buyer.id, priceAmount: 12.34, currency: "USD", status: "purchased" } },
        activityLogs: { create: { action: "test", message: "Preserve this history", level: "info" } },
      } });
      await tx.appSettings.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
      await tx.appSettings.update({ where: { id: "default" }, data: { defaultBuyerId: buyer.id, defaultRegistrarId: registrar.id, defaultRegistrantId: profile.id, defaultCloudflareId: cloudflare.id, defaultKeitaroServerId: keitaro.id, defaultHestiaServerId: hestia.id, defaultHestiaUser: "web" } });
      const pending = await tx.job.create({ data: { type: "test", status: "queued", payload: { nested: [{ buyerId: buyer.id }] } } });
      await assert.rejects(deleteSettingInTransaction(tx, "buyer", buyer.id), /queued operations/);
      assert.equal((await tx.buyer.findUniqueOrThrow({ where: { id: buyer.id } })).deletedAt, null);
      await tx.job.delete({ where: { id: pending.id } });
      await deleteSettingInTransaction(tx, "buyer", buyer.id);
      let spending = await getSpending(tx);
      assert(!spending.buyers.some(b => b.id === buyer.id));
      assert.equal(spending.groups.find(g => g.id === group.id)?.totals.find(t => t.currency === "USD")?.spend, 12.34);
      const before = serializeDomain(await tx.domain.findUniqueOrThrow({ where: { id: domain.id }, include: managedDomainInclude }));
      for (const [kind, id] of [["buyerGroup", group.id], ["registrarAccount", registrar.id], ["registrantProfile", profile.id], ["cloudflareAccount", cloudflare.id], ["keitaroServer", keitaro.id], ["hestiaServer", hestia.id]] as const) {
        await deleteSettingInTransaction(tx, kind, id);
        await deleteSettingInTransaction(tx, kind, id); // repeated DELETE is harmless
      }
      const after = serializeDomain(await tx.domain.findUniqueOrThrow({ where: { id: domain.id }, include: managedDomainInclude }));
      assert.equal(after.buyer?.name, buyer.name);
      assert.equal(after.buyerGroup?.name, group.name);
      assert.equal(after.registrar.name, registrar.name);
      assert.equal(after.cloudflare?.account.name, cloudflare.name);
      assert.equal(after.keitaro?.server.name, keitaro.name);
      assert.equal(after.hestia?.server.name, hestia.name);
      assert.equal(after.purchasePrice, before.purchasePrice);
      assert.equal(after.dns.ip, before.dns.ip);
      assert.equal(await tx.domainPurchase.count({ where: { domainId: domain.id } }), 1);
      assert.equal(await tx.activityLog.count({ where: { domainId: domain.id } }), 1);
      const defaults = await tx.appSettings.findUniqueOrThrow({ where: { id: "default" } });
      for (const field of ["defaultBuyerId", "defaultRegistrarId", "defaultRegistrantId", "defaultCloudflareId", "defaultKeitaroServerId", "defaultHestiaServerId", "defaultHestiaUser"] as const) assert.equal(defaults[field], null);
      spending = await getSpending(tx);
      assert(!spending.groups.some(g => g.id === group.id));
      await tx.buyerGroup.create({ data: { name: group.name.toUpperCase() } });
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.log("PASS: deletion preserves Purchased relations, spend, DNS, purchases and logs; clears defaults; blocks queued work; hides choices; permits group-name reuse. Fixtures rolled back.");
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });
