import { prisma } from "@/lib/db";
import { getCloudflare } from "@/lib/integrations/factory";

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
