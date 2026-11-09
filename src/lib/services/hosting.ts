import { isIP } from "node:net";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getCloudflare } from "@/lib/integrations/factory";
import { addDomainToCloudflare, addDomainToHestia } from "./provisioning";

export async function deployDomainToServer(domainId: string, input: {
  serverId: string; cloudflareAccountId?: string; webUser?: string; ip?: string | null;
}) {
  const server = await prisma.hestiaServer.findFirst({ where: { id: input.serverId, enabled: true } });
  if (!server) throw new AppError({ message: "Hosting server not found or disabled", status: 404 });
  if (isIP(input.ip || server.ipAddress || "") !== 4) throw new AppError({ message: "Set a valid server IPv4 address in Settings → Servers" });
  const domain = await prisma.domain.findUnique({ where: { id: domainId }, include: { cloudflare: true } });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });
  if (!["purchased", "active"].includes(domain.status)) throw new AppError({ message: "Only registered domains can be added to a server" });
  if (!domain.cloudflare?.zoneId || domain.cloudflare.status === "failed") {
    const accountId = domain.cloudflare?.accountId || input.cloudflareAccountId;
    if (!accountId) throw new AppError({ message: "Choose a Cloudflare account to configure DNS" });
    const { adapter, account } = await getCloudflare(accountId);
    if (!account.enabled) throw new AppError({ message: "Cloudflare account is disabled" });
    if (!domain.cloudflare?.zoneId && !await adapter.getZone(domain.domain)) await adapter.assertZoneCapacity();
    await addDomainToCloudflare(domainId, accountId);
  }
  return addDomainToHestia(domainId, server.id, input.webUser, input.ip);
}
