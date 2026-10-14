import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type SpendTotal = { currency: string; spend: number; spendThisMonth: number };

// Buyer purchases follow current membership; direct group purchases have no buyer.
export async function getSpending(db: Prisma.TransactionClient = prisma) {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const purchased = { OR: [{ registeredAt: { not: null } }, { status: { in: ["purchased", "active"] as ("purchased" | "active")[] } }] };
  const [buyers, groups, totals, monthTotals] = await Promise.all([
    db.buyer.findMany({ include: { group: true }, orderBy: { name: "asc" } }),
    db.buyerGroup.findMany({ orderBy: { name: "asc" } }),
    db.domain.groupBy({ by: ["buyerId", "groupId", "currency"], where: purchased, _count: { _all: true }, _sum: { purchasePrice: true } }),
    db.domain.groupBy({ by: ["buyerId", "groupId", "currency"], where: { AND: [purchased, { OR: [{ registeredAt: { gte: month } }, { registeredAt: null, createdAt: { gte: month } }] }] }, _sum: { purchasePrice: true } }),
  ]);
  const buyerMap = new Map(buyers.map((buyer) => [buyer.id, buyer]));
  const buyerSpend = new Map<string, { domainCount: number; totals: SpendTotal[] }>();
  const groupSpend = new Map<string, { domainCount: number; totals: SpendTotal[] }>();
  function add(map: typeof buyerSpend, id: string | null | undefined, currency: string, spend: number, count: number, monthly: boolean) {
    if (!id) return;
    const summary = map.get(id) ?? { domainCount: 0, totals: [] };
    let total = summary.totals.find((item) => item.currency === currency);
    if (!total) { total = { currency, spend: 0, spendThisMonth: 0 }; summary.totals.push(total); }
    if (monthly) total.spendThisMonth += spend;
    else { total.spend += spend; summary.domainCount += count; }
    map.set(id, summary);
  }
  for (const row of totals) {
    const groupId = row.buyerId ? buyerMap.get(row.buyerId)?.groupId : row.groupId;
    add(buyerSpend, row.buyerId, row.currency, Number(row._sum.purchasePrice ?? 0), row._count._all, false);
    add(groupSpend, groupId, row.currency, Number(row._sum.purchasePrice ?? 0), row._count._all, false);
  }
  for (const row of monthTotals) {
    const groupId = row.buyerId ? buyerMap.get(row.buyerId)?.groupId : row.groupId;
    add(buyerSpend, row.buyerId, row.currency, Number(row._sum.purchasePrice ?? 0), 0, true);
    add(groupSpend, groupId, row.currency, Number(row._sum.purchasePrice ?? 0), 0, true);
  }
  const empty = () => ({ domainCount: 0, totals: [] as SpendTotal[] });
  return {
    buyers: buyers.map((buyer) => {
      const summary = buyerSpend.get(buyer.id) ?? empty();
      const first = summary.totals[0];
      return { id: buyer.id, name: buyer.name, isDefault: buyer.isDefault, stageName: buyer.stageName, groupId: buyer.groupId, group: buyer.group, ...summary, spend: first?.spend ?? 0, spendThisMonth: first?.spendThisMonth ?? 0, currency: first?.currency ?? "USD" };
    }),
    groups: groups.map((group) => ({ ...group, buyerCount: buyers.filter((buyer) => buyer.groupId === group.id).length, ...(groupSpend.get(group.id) ?? empty()) })),
  };
}
