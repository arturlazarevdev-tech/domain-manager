import { prisma } from "@/lib/db";
import { AppError, detailedErrorMessage } from "@/lib/errors";
import { getCloudflare } from "@/lib/integrations/factory";
import { logActivity } from "@/lib/services/activity";
import { updateKeitaroDns, validateServerIp } from "./keitaro-dns";

export type IpUpdatePayload = { serverId: string; ip: string; domainIds: string[] };
export type IpUpdateResult = { domainId: string; domain: string; ok: boolean; error?: string };
export const ipUpdateJobType = "keitaro-ip-update";

export async function createKeitaroIpJob(serverId: string, ip: string) {
  try { validateServerIp(ip); } catch { throw new AppError({ message: "Enter a valid IPv4 address", status: 400 }); }
  return prisma.$transaction(async tx => {
    // Serialize enqueue requests for this server, including different web processes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`keitaro-ip:${serverId}`}))`;
    const server = await tx.keitaroServer.findUnique({ where: { id: serverId } });
    if (!server) throw new AppError({ message: "Server not found", status: 404 });
    const active = await tx.job.findFirst({ where: { type: ipUpdateJobType, status: { in: ["queued", "running"] }, payload: { path: ["serverId"], equals: serverId } } });
    if (active) throw new AppError({ message: "An IP update is already running for this server", status: 409 });
    const domains = await tx.domainKeitaro.findMany({ where: { serverId }, select: { domainId: true } });
    // A hostname-based API URL remains stable. Replace a literal old IP only.
    const url = new URL(server.url);
    if (url.hostname === server.ipAddress) url.hostname = ip;
    await tx.keitaroServer.update({ where: { id: serverId }, data: { ipAddress: ip, url: url.toString().replace(/\/$/, "") } });
    return tx.job.create({ data: { type: ipUpdateJobType, status: "queued", payload: { serverId, ip, domainIds: domains.map(d => d.domainId) }, result: { results: [] } } });
  });
}

export async function processKeitaroIpJob(jobId: string, payload: IpUpdatePayload) {
  validateServerIp(payload.ip);
  const results: IpUpdateResult[] = [];
  for (const domainId of payload.domainIds) {
    let name = domainId;
    try {
      const domain = await prisma.domain.findUnique({ where: { id: domainId }, include: { cloudflare: true, keitaro: true } });
      if (!domain || domain.keitaro?.serverId !== payload.serverId) throw new Error("Domain is no longer assigned to this server");
      name = domain.domain;
      if (!domain.cloudflare?.zoneId) throw new Error("No linked Cloudflare zone; update DNS at its provider manually");
      const { adapter } = await getCloudflare(domain.cloudflare.accountId);
      const records = await updateKeitaroDns(adapter, domain.cloudflare.zoneId, domain.domain, payload.ip);
      await prisma.$transaction(async tx => {
        const current = await tx.domainKeitaro.findUnique({ where: { domainId } });
        if (current?.serverId !== payload.serverId) throw new Error("Domain assignment changed during the update; review DNS");
        await tx.domainDnsRecord.deleteMany({ where: { domainId } });
        if (records.length) await tx.domainDnsRecord.createMany({ data: records.map(r => ({ domainId, type: r.type, name: r.name, content: r.content, proxied: r.proxied, providerId: r.id })) });
        await tx.domainKeitaro.update({ where: { domainId }, data: { serverIp: payload.ip } });
      });
      await logActivity({ domainId, jobId, action: "keitaro.ip_updated", message: `DNS verified at ${payload.ip}`, level: "success" });
      results.push({ domainId, domain: name, ok: true });
    } catch (error) {
      const message = detailedErrorMessage(error, "IP update failed");
      results.push({ domainId, domain: name, ok: false, error: message });
      await logActivity({ jobId, action: "keitaro.ip_failed", message: `${name}: ${message}`, level: "error" });
    }
    await prisma.job.update({ where: { id: jobId }, data: { result: { results }, progress: { total: payload.domainIds.length, completed: results.length } } });
  }
  const failed = results.filter(r => !r.ok).length;
  if (failed) throw new Error(`${failed} of ${results.length} domains failed. Retry after resolving the listed errors.`);
}
