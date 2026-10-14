import { getSpending } from "@/lib/services/spending";
import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { serializeDomain } from "@/lib/serializers";


export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const [domains, cloudflare, keitaro, hestia, recent, spending] = await Promise.all([
      prisma.domain.count(),
      prisma.cloudflareAccount.count({ where: { enabled: true } }),
      prisma.keitaroServer.count({ where: { enabled: true } }),
      prisma.hestiaServer.count({ where: { enabled: true } }),
      prisma.domain.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          registrar: true,
          buyer: { include: { group: true } },
          buyerGroup: true,
          cloudflare: { include: { account: true } },
          keitaro: { include: { server: true } },
          hestia: { include: { server: true } },
          dnsRecords: true,
        },
      }),
      getSpending(),
    ]);

    return Response.json({
      domains,
      cloudflare,
      keitaro,
      hestia,
      spendByBuyer: spending.buyers.filter((buyer) => buyer.domainCount > 0),
      spendByGroup: spending.groups,
      recent: recent.map((domain) => {
        const row = serializeDomain(domain);
        return {
          id: row.id,
          domain: row.domain,
          registrar: row.registrar.name,
          price: row.purchasePrice,
          currency: row.currency,
          buyer: row.buyer?.name ?? "Group purchase",
          buyerGroup: row.buyerGroup?.name ?? "—",
          cloudflare: row.cloudflare?.account.name ?? "—",
          server: row.server?.name ?? "—",
          status: row.status,
          purchasedAt: row.purchasedAt,
        };
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
