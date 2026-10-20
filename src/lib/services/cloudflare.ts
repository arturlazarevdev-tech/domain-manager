import { prisma } from "@/lib/db";
import { getCloudflare } from "@/lib/integrations/factory";
import { AppError } from "@/lib/errors";
import { cloudflareZoneLimit } from "@/lib/integrations/cloudflare/limits";

export async function assertCloudflareReadyForPurchase(accountId: string) {
  const { account, adapter } = await getCloudflare(accountId);
  if (!account.enabled) throw new AppError({ message: "Selected Cloudflare account is disabled" });
  // A known recent rejection is stronger evidence than the public zone counts,
  // since Cloudflare applies additional account-specific creation limits.
  const recentLimit = await prisma.domainCloudflare.findFirst({
    where: {
      accountId, status: "failed", zoneId: null,
      updatedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      OR: [
        { errorMessage: { contains: "limit for adding zones", mode: "insensitive" } },
        { errorMessage: { contains: "Cloudflare zone limit reached", mode: "insensitive" } },
      ],
    },
  });
  if (recentLimit) throw cloudflareZoneLimit("No new purchase was submitted. This account recently rejected zone creation.");
  await adapter.assertZoneCapacity();
}

export async function testAndStoreCloudflareConnection(id: string) {
  const { adapter } = await getCloudflare(id);
  const result = await adapter.testConnection();
  let zoneCount: number | undefined;
  if (result.ok) {
    try {
      zoneCount = await adapter.countZones();
    } catch {
      zoneCount = undefined;
    }
  }
  await prisma.cloudflareAccount.update({
    where: { id },
    data: {
      connectionStatus: result.ok ? "connected" : "error",
      lastError: result.ok ? null : result.message,
      lastTestedAt: new Date(),
    },
  });
  return { ...result, zoneCount };
}
