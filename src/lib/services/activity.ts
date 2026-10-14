import { prisma } from "@/lib/db";

export async function logActivity(input: {
  domainId?: string;
  jobId?: string;
  action: string;
  message: string;
  level?: "info" | "success" | "warning" | "error";
  metadata?: Record<string, unknown>;
}) {
  return prisma.activityLog.create({
    data: {
      domainId: input.domainId,
      jobId: input.jobId,
      action: input.action,
      message: input.message,
      level: input.level ?? "info",
      metadata: input.metadata as object | undefined,
    },
  });
}
