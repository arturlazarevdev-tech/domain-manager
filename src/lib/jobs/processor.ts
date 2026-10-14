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
      await processPurchaseJob(jobId);
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
