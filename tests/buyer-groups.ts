import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { getSpending } from "../src/lib/services/spending";
import { assignmentSchema, purchaseSchema } from "../src/lib/validators";
import { serializeDomain } from "../src/lib/serializers";

loadEnvConfig(process.cwd());
const db = new PrismaClient();
const rollback = new Error("Rollback test fixtures");
async function main() {
  const purchase = { domains: ["example.com"], registrarId: "r", registrantId: "p", cloudflareAccountId: "c" };
  assert(purchaseSchema.safeParse({ ...purchase, buyerId: "b" }).success);
  assert(purchaseSchema.safeParse({ ...purchase, groupId: "g", buyerId: null }).success);
  assert(!purchaseSchema.safeParse({ ...purchase, groupId: "g", buyerId: "b" }).success);
  assert(!purchaseSchema.safeParse(purchase).success);
  assert(!assignmentSchema.safeParse({ groupId: "g", buyerId: "b" }).success);
  try {
    await db.$transaction(async (tx) => {
      const tag = crypto.randomUUID();
      const group = await tx.buyerGroup.create({ data: { name: `Test ${tag}` } });
      const other = await tx.buyerGroup.create({ data: { name: `Other ${tag}` } });
      const buyer = await tx.buyer.create({ data: { name: `Buyer ${tag}` } });
      const registrar = await tx.registrarAccount.create({ data: { name: `Test ${tag}`, provider: "regway", credentialsEncrypted: "test" } });
      const now = new Date();
      const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10));
      let index = 0;
      async function domain(amount: number, currency: string, registeredAt: Date | null, buyerId: string | null, groupId: string | null, status: "purchased" | "failed" = "purchased") {
        return tx.domain.create({ data: { domain: `${tag}-${++index}.example`, tld: "example", registrarId: registrar.id, purchasePrice: amount, currency, registeredAt, buyerId, groupId, status } });
      }
      // Existing purchases gain group attribution after membership is assigned.
      const old = await domain(10, "USD", previous, buyer.id, null);
      await domain(20, "USD", now, buyer.id, null);
      await domain(5, "EUR", now, buyer.id, null);
      await domain(7, "USD", now, null, group.id);
      await domain(99, "USD", null, buyer.id, null, "failed");
      await tx.buyer.update({ where: { id: buyer.id }, data: { groupId: group.id } });
      let spending = await getSpending(tx);
      const team = spending.groups.find((item) => item.id === group.id)!;
      const person = spending.buyers.find((item) => item.id === buyer.id)!;
      assert.equal(team.domainCount, 4);
      assert.equal(person.domainCount, 3);
      assert.deepEqual(team.totals.find((item) => item.currency === "USD"), { currency: "USD", spend: 37, spendThisMonth: 27 });
      assert.deepEqual(person.totals.find((item) => item.currency === "USD"), { currency: "USD", spend: 30, spendThisMonth: 20 });
      assert.equal(team.totals.find((item) => item.currency === "EUR")?.spend, 5);
      const include = { registrar: true, buyer: { include: { group: true } }, buyerGroup: true, cloudflare: { include: { account: true } }, keitaro: { include: { server: true } }, hestia: { include: { server: true } } } as const;
      const row = await tx.domain.findUniqueOrThrow({ where: { id: old.id }, include });
      assert.equal(serializeDomain(row).buyerGroup?.id, group.id);
      await tx.buyer.update({ where: { id: buyer.id }, data: { groupId: other.id } });
      spending = await getSpending(tx);
      assert.equal(spending.groups.find((item) => item.id === group.id)?.domainCount, 1);
      assert.equal(spending.groups.find((item) => item.id === other.id)?.domainCount, 3);
      await tx.domain.update({ where: { id: old.id }, data: { buyerId: null, groupId: group.id } });
      spending = await getSpending(tx);
      assert.equal(spending.buyers.find((item) => item.id === buyer.id)?.domainCount, 2);
      assert.equal(spending.groups.find((item) => item.id === group.id)?.domainCount, 2);
      throw rollback;
    }, { timeout: 20000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.log("PASS: recipient validation, existing buyer purchases, direct group spend, monthly totals, currencies, failed purchases, membership changes and reassignment. Fixtures rolled back.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
