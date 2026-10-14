import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { serializeDomain } from "@/lib/serializers";
import type { JobProgress } from "@/lib/jobs/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return Response.json({ error: { message: "Job not found" } }, { status: 404 });
    const progress = job.progress as JobProgress | null;
    const domainIds = (progress?.items ?? []).map((item) => item.domainId).filter(Boolean) as string[];
    const domains = domainIds.length
      ? await prisma.domain.findMany({
          where: { id: { in: domainIds } },
          include: {
            registrar: true,
            buyer: { include: { group: true } },
            buyerGroup: true,
            cloudflare: { include: { account: true } },
            keitaro: { include: { server: true } },
            hestia: { include: { server: true } },
            dnsRecords: true,
          },
        })
      : [];
    const activityLogs = await prisma.activityLog.findMany({
      where: { jobId: id },
      orderBy: { createdAt: "asc" },
    });
    return Response.json({ job, domains: domains.map(serializeDomain), activityLogs });
  } catch (error) {
    return jsonError(error);
  }
}
