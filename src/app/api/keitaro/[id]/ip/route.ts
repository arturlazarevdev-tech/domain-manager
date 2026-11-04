import { z } from "zod";
import { requireAdmin } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/errors";
import { enqueueJob } from "@/lib/jobs/queue";
import { createKeitaroIpJob, ipUpdateJobType } from "@/lib/services/keitaro-ip";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const job = await prisma.job.findFirst({ where: { type: ipUpdateJobType, payload: { path: ["serverId"], equals: id } }, orderBy: { createdAt: "desc" } });
    return Response.json({ job });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const { ip } = z.object({ ip: z.string().trim().min(1) }).parse(await request.json());
    const job = await createKeitaroIpJob(id, ip);
    try { await enqueueJob(job.id, ipUpdateJobType); }
    catch {
      await prisma.job.update({ where: { id: job.id }, data: { status: "failed", error: "Could not queue update. Retry when the worker is available." } });
      throw new Error("Could not queue update. Retry when the worker is available.");
    }
    return Response.json({ job }, { status: 202 });
  } catch (error) { return jsonError(error); }
}
