import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, detailedErrorMessage } from "@/lib/errors";
import { refreshCloudflareStatus } from "./provisioning";

export const bulkRefreshSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ domainIds: z.array(z.string().trim().min(1)).min(1).max(1000) }).strict(),
]);

export async function refreshDomainSelection(input: unknown) {
  const body = bulkRefreshSchema.parse(input);
  if ("all" in body) {
    await refreshCloudflareStatus(undefined, { syncDns: true, all: true });
    return { ok: true as const };
  }
  const ids = [...new Set(body.domainIds)];
  const domains = await prisma.domain.findMany({ where: { id: { in: ids } }, select: { id: true, domain: true, cloudflare: { select: { id: true } } } });
  if (domains.length !== ids.length) throw new AppError({ message: "Some selected domains no longer exist. Reload the list and select them again.", status: 404 });
  const results: Array<{ id: string; domain: string; ok: boolean; skipped?: boolean; error?: string }> = [];
  for (const domain of domains) {
    if (!domain.cloudflare) {
      results.push({ id: domain.id, domain: domain.domain, ok: false, skipped: true });
      continue;
    }
    try {
      await refreshCloudflareStatus(domain.id);
      results.push({ id: domain.id, domain: domain.domain, ok: true });
    } catch (error) {
      results.push({ id: domain.id, domain: domain.domain, ok: false, error: detailedErrorMessage(error, "Refresh failed") });
    }
  }
  return { ok: results.every(result => result.ok || result.skipped), results };
}
