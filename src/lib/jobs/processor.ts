import { openproviderRequestContext } from "@/lib/integrations/registrars/openprovider/context";
import { prisma } from "@/lib/db";
import type { JobProgress } from "@/lib/jobs/types";
import { logActivity } from "@/lib/services/activity";
import { processPurchaseJob } from "@/lib/services/purchase";
import { refreshCloudflareStatus } from "@/lib/services/provisioning";

export async function processJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status === "completed") return;

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "running" },
  });

  try {
    if (job.type === "purchase") {
      await openproviderRequestContext.run({ onWait: async ms => {
        const current = await prisma.job.findUnique({ where: { id: jobId } });
        const progress = current?.progress as JobProgress | null;
        const active = progress?.items.find(item => item.status === "purchasing" || item.status === "queued");
        if (active && progress) {
          active.step = `Waiting for Openprovider API limit (${Math.ceil(ms / 1000)} seconds)`;
          await prisma.job.update({ where: { id: jobId }, data: { progress: progress as object } });
        }
      } }, () => processPurchaseJob(jobId));
    } else if (job.type === "cloudflare-refresh") {
      await refreshCloudflareStatus();
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: "completed" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job failed";
    await logActivity({
      jobId,
      action: "job.failed",
      message,
      level: "error",
    });
    await prisma.domainPurchase.updateMany({
      where: { jobId, status: { in: ["queued", "purchasing"] } },
      data: { status: "failed", errorMessage: message },
    });
    const current = await prisma.job.findUnique({ where: { id: jobId } });
    const progress = current?.progress as JobProgress | null;
    if (progress?.items?.length) {
      for (const item of progress.items) {
        if (item.status === "queued" || item.status === "purchasing") {
          item.status = "failed";
          item.error = message;
        }
      }
    }
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error: message,
        ...(progress ? { progress: progress as object } : {}),
      },
    });
  }
}
