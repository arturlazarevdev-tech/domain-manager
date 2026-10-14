import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { serializeDomain } from "@/lib/serializers";
import { logActivity } from "@/lib/services/activity";
import { assignmentSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const domain = await prisma.domain.findFirst({
      where: { OR: [{ id }, { domain: decodeURIComponent(id) }] },
      include: {
        registrar: true,
        buyer: { include: { group: true } },
        buyerGroup: true,
        cloudflare: { include: { account: true } },
        keitaro: { include: { server: true } },
        hestia: { include: { server: true } },
        dnsRecords: true,
        activityLogs: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!domain) return Response.json({ error: { message: "Domain not found" } }, { status: 404 });
    return Response.json({
      domain: {
        ...serializeDomain(domain),
        activityLogs: domain.activityLogs,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = assignmentSchema.parse(await request.json());
    const domain = await prisma.domain.findFirst({
      where: { OR: [{ id }, { domain: decodeURIComponent(id) }] },
      include: { buyer: true, buyerGroup: true },
    });
    if (!domain) return Response.json({ error: { message: "Domain not found" } }, { status: 404 });
    const buyer = body.buyerId ? await prisma.buyer.findUnique({ where: { id: body.buyerId } }) : null;
    const group = body.groupId ? await prisma.buyerGroup.findUnique({ where: { id: body.groupId } }) : null;
    if (body.groupId && !group) return Response.json({ error: { message: "Group not found" } }, { status: 404 });
    if (body.buyerId && !buyer) return Response.json({ error: { message: "Buyer not found" } }, { status: 404 });
    const updated = await prisma.domain.update({
      where: { id: domain.id },
      data: { buyerId: buyer?.id ?? null, groupId: group?.id ?? null },
      include: {
        registrar: true,
        buyer: { include: { group: true } },
        buyerGroup: true,
        cloudflare: { include: { account: true } },
        keitaro: { include: { server: true } },
        hestia: { include: { server: true } },
        dnsRecords: true,
      },
    });
    await logActivity({
      domainId: domain.id,
      action: "domain.buyer_changed",
      message: `Assignment changed from ${domain.buyer?.name ?? domain.buyerGroup?.name ?? "none"} to ${buyer?.name ?? group?.name}`,
    });
    return Response.json({ domain: serializeDomain(updated) });
  } catch (error) {
    return jsonError(error);
  }
}
