import { isIP } from "node:net";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getCloudflare, getHestia, getKeitaro } from "@/lib/integrations/factory";
import { getRegistrar } from "@/lib/integrations/registrars/factory";
import { logActivity } from "@/lib/services/activity";

export async function addDomainToCloudflare(domainId: string, accountId: string) {
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });

  const cf = await prisma.domainCloudflare.upsert({
    where: { domainId },
    create: { domainId, accountId, status: "creating" },
    update: { accountId, status: "creating", zoneId: null, errorMessage: null },
  });

  await logActivity({
    domainId,
    action: "cloudflare.creating",
    message: `Adding ${domain.domain} to Cloudflare`,
  });

  try {
    const { adapter, account } = await getCloudflare(accountId);
    const zone = await adapter.createZone(domain.domain);
    await prisma.domainCloudflare.update({
      where: { id: cf.id },
      data: {
        zoneId: zone.zoneId,
        nameservers: zone.nameservers,
        status: zone.nameservers.length ? "waiting_nameservers" : "creating",
      },
    });
    await logActivity({
      domainId,
      action: "cloudflare.ns_received",
      message: `Cloudflare nameservers received: ${zone.nameservers.join(", ")}`,
      level: "success",
    });

    if (zone.nameservers.length >= 2) {
      try {
        const registrar = await getRegistrar(domain.registrarId);
        const alreadySame = sameNameservers(domain.nameservers, zone.nameservers);
        if (!alreadySame) {
          await registrar.setNameservers(domain.domain, zone.nameservers);
        }
        await prisma.domain.update({
          where: { id: domainId },
          data: { nameservers: zone.nameservers },
        });
        await prisma.domainCloudflare.update({
          where: { id: cf.id },
          data: { status: zone.status === "active" ? "active" : "pending", errorMessage: null },
        });
        await logActivity({
          domainId,
          action: "registrar.ns_updated",
          message: alreadySame
            ? "Nameservers at registrar already match Cloudflare"
            : "Nameservers sent to registrar",
          level: "success",
        });
      } catch (error) {
        const details = error instanceof Error ? error.message : "Nameserver update failed";
        if (/same value for new and old nameservers/i.test(details)) {
          await prisma.domain.update({
            where: { id: domainId },
            data: { nameservers: zone.nameservers },
          });
          await prisma.domainCloudflare.update({
            where: { id: cf.id },
            data: { status: zone.status === "active" ? "active" : "pending", errorMessage: null },
          });
          await logActivity({
            domainId,
            action: "registrar.ns_updated",
            message: "Nameservers at registrar already match Cloudflare",
            level: "success",
          });
        } else {
          await prisma.domainCloudflare.update({
            where: { id: cf.id },
            data: { status: "failed", errorMessage: details },
          });
          await logActivity({
            domainId,
            action: "registrar.ns_failed",
            message: `Cloudflare zone created, but nameservers could not be updated at registrar. Domain was purchased successfully. ${details}`,
            level: "error",
          });
          throw new AppError({
            message: "Cloudflare zone created, but nameservers could not be updated at registrar.",
            details: `Domain was purchased successfully. ${account.name} zone exists. Retry nameserver update.`,
            provider: "registrar",
            retryable: true,
          });
        }
      }
    }

    return prisma.domainCloudflare.findUnique({ where: { domainId } });
  } catch (error) {
    const details = error instanceof AppError ? error.message : error instanceof Error ? error.message : "Cloudflare failed";
    await prisma.domainCloudflare.update({
      where: { id: cf.id },
      data: { status: "failed", errorMessage: details },
    });
    await logActivity({
      domainId,
      action: "cloudflare.failed",
      message: details,
      level: "error",
    });
    throw error;
  }
}

export async function pointDomainDns(domainId: string, ip: string) {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    include: { cloudflare: true },
  });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });
  if (!domain.cloudflare?.zoneId) {
    throw new AppError({
      message: "Add the domain to Cloudflare before creating DNS records.",
      status: 400,
    });
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const proxied = settings?.dnsProxied ?? true;
  const wwwMode = settings?.wwwRecordMode === "cname" ? "cname" : "a";
  const { adapter } = await getCloudflare(domain.cloudflare.accountId);
  const zoneId = domain.cloudflare.zoneId;
  const existing = await adapter.listDnsRecords(zoneId);
  const apexNames = new Set([domain.domain.toLowerCase(), "@"]);
  const wwwNames = new Set([`www.${domain.domain}`.toLowerCase(), "www"]);

  for (const record of existing) {
    const name = record.name.replace(/\.$/, "").toLowerCase();
    const isApex = apexNames.has(name) || record.name === "@";
    const isWww = wwwNames.has(name);
    if (isApex && record.type === "CNAME") {
      await adapter.deleteDnsRecord(zoneId, record.id);
    }
    if (isWww && ((wwwMode === "a" && record.type === "CNAME") || (wwwMode === "cname" && ["A", "AAAA"].includes(record.type)))) {
      await adapter.deleteDnsRecord(zoneId, record.id);
    }
  }

  const apex = await adapter.upsertDnsRecord(zoneId, {
    type: "A",
    name: domain.domain,
    content: ip,
    proxied,
  });
  const www =
    wwwMode === "cname"
      ? await adapter.upsertDnsRecord(zoneId, {
          type: "CNAME",
          name: `www.${domain.domain}`,
          content: domain.domain,
          proxied,
        })
      : await adapter.upsertDnsRecord(zoneId, {
          type: "A",
          name: `www.${domain.domain}`,
          content: ip,
          proxied,
        });

  await prisma.domainDnsRecord.deleteMany({ where: { domainId, name: { in: ["@", "www", domain.domain, `www.${domain.domain}`] }, type: { in: ["A", "CNAME"] } } });
  await prisma.domainDnsRecord.createMany({
    data: [
      {
        domainId,
        type: "A",
        name: "@",
        content: ip,
        proxied,
        providerId: apex.id,
      },
      {
        domainId,
        type: www.type,
        name: "www",
        content: www.content,
        proxied,
        providerId: www.id,
      },
    ],
  });

  await logActivity({
    domainId,
    action: "dns.updated",
    message: `Cloudflare DNS pointed to ${ip}`,
    level: "success",
  });

  return prisma.domainDnsRecord.findMany({ where: { domainId } });
}

export async function addDomainToKeitaro(domainId: string, serverId: string, group?: string | null, overrideIp?: string | null) {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    include: { buyer: true, cloudflare: true },
  });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });
  const groupName = (group !== undefined ? group ?? "" : domain.buyer?.name || domain.buyer?.keitaroGroup || domain.buyer?.stageName || "").trim() || null;

  const { adapter, server } = await getKeitaro(serverId);
  const ip = (overrideIp || server.ipAddress)?.trim();
  if (!ip) {
    throw new AppError({
      message: `Set an IP address on Keitaro server ${server.name} before adding domains.`,
      status: 400,
    });
  }
  if (!domain.cloudflare?.zoneId) {
    throw new AppError({
      message: "Domain must be on Cloudflare before adding to Keitaro. Nameservers stay on Cloudflare.",
      status: 400,
    });
  }

  if (isIP(ip) !== 4) throw new AppError({ message: "Keitaro DNS requires a valid IPv4 address" });

  const record = await prisma.domainKeitaro.upsert({
    where: { domainId },
    create: { domainId, serverId, groupName, serverIp: ip, status: "adding" },
    update: { serverId, groupName, serverIp: ip, status: "adding", errorMessage: null },
  });

  try {
    const created = await adapter.addDomain(domain.domain, { group: groupName });
    await pointDomainDns(domainId, ip);
    await prisma.domainKeitaro.update({
      where: { id: record.id },
      data: {
        keitaroDomainId: created.id,
        groupName,
        serverIp: ip,
        status: "active",
        addedAt: new Date(),
      },
    });
    await logActivity({
      domainId,
      action: "keitaro.added",
      message: groupName ? `Added to ${server.name} as ${groupName}` : `Added to ${server.name}`,
      level: "success",
    });
    return prisma.domainKeitaro.findUnique({ where: { domainId }, include: { server: true } });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Keitaro failed";
    await prisma.domainKeitaro.update({
      where: { id: record.id },
      data: { status: "failed", errorMessage: details },
    });
    await logActivity({
      domainId,
      action: "keitaro.failed",
      message: details,
      level: "error",
    });
    throw error;
  }
}

export async function addDomainToHestia(domainId: string, serverId: string, webUser?: string | null, ip?: string | null) {
  const domain = await prisma.domain.findUnique({
    where: { id: domainId },
    include: { cloudflare: true },
  });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });

  const { adapter, server } = await getHestia(serverId);
  const user = (webUser || server.username || "admin").trim();
  let targetIp = (ip || server.ipAddress || "").trim();
  if (!targetIp) {
    const ips = await adapter.listIps(user).catch(() => []);
    targetIp = ips[0] ?? "";
  }
  if (!targetIp) {
    throw new AppError({
      message: `Set an IP address on Hestia server ${server.name} before adding domains.`,
      status: 400,
    });
  }
  if (!domain.cloudflare?.zoneId) {
    throw new AppError({
      message: "Domain must be on Cloudflare before adding to Hestia. Nameservers stay on Cloudflare.",
      status: 400,
    });
  }

  if (isIP(targetIp) !== 4) throw new AppError({ message: "Hestia DNS requires a valid IPv4 address" });

  const record = await prisma.domainHestia.upsert({
    where: { domainId },
    create: { domainId, serverId, webUser: user, ip: targetIp, status: "adding" },
    update: { serverId, webUser: user, ip: targetIp, status: "adding", errorMessage: null },
  });

  try {
    await adapter.addWebDomain(user, domain.domain, targetIp);
    await pointDomainDns(domainId, targetIp);
    await prisma.domainHestia.update({
      where: { id: record.id },
      data: {
        status: "active",
        addedAt: new Date(),
        hestiaDomainId: domain.domain,
        ip: targetIp,
      },
    });
    await logActivity({
      domainId,
      action: "hestia.added",
      message: `Added to ${server.name} as ${user}`,
      level: "success",
    });
    return prisma.domainHestia.findUnique({ where: { domainId }, include: { server: true } });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Hestia failed";
    await prisma.domainHestia.update({
      where: { id: record.id },
      data: { status: "failed", errorMessage: details },
    });
    await logActivity({
      domainId,
      action: "hestia.failed",
      message: details,
      level: "error",
    });
    throw error;
  }
}

export async function refreshCloudflareStatus(domainId?: string, options: { syncDns?: boolean; all?: boolean } = {}) {
  const syncDns = options.syncDns ?? Boolean(domainId);
  const failures: string[] = [];
  const pending = await prisma.domainCloudflare.findMany({
    where: domainId
      ? {
          OR: [{ domainId }, { domain: { domain: decodeURIComponent(domainId) } }],
        }
      : options.all ? {} : { status: { in: ["pending", "waiting_nameservers", "creating"] } },
    include: { domain: true, account: true },
  });
  let last: { status: string; nameservers: string[]; zoneId: string | null } | null = null;
  for (const item of pending) {
    try {
      const { adapter } = await getCloudflare(item.accountId);
      const zone = item.zoneId
        ? await adapter.getZoneById(item.zoneId)
        : await adapter.getZone(item.domain.domain);
      if (!zone) throw new AppError({ message: `Cloudflare zone not found for ${item.domain.domain}` });
      // Read every page before replacing the snapshot. A failed read leaves cached DNS intact.
      const records = syncDns ? await adapter.listDnsRecords(zone.zoneId) : undefined;
      const status = zone.status === "active" ? "active" : "pending";
      await prisma.$transaction(async (tx) => {
        await tx.domainCloudflare.update({
          where: { id: item.id },
          data: { status, nameservers: zone.nameservers, zoneId: zone.zoneId, errorMessage: null },
        });
        if (records) {
          await tx.domainDnsRecord.deleteMany({ where: { domainId: item.domainId } });
          if (records.length) await tx.domainDnsRecord.createMany({ data: records.map((record) => ({
            domainId: item.domainId, type: record.type, name: record.name, content: record.content,
            proxied: record.proxied, providerId: record.id,
          })) });
        }
      });
      if (records) await logActivity({ domainId: item.domainId, action: "dns.synced", message: `Synced ${records.length} DNS records from Cloudflare`, level: "success" });
      last = { status, nameservers: zone.nameservers, zoneId: zone.zoneId };
      if (status === "active") {
        await prisma.domain.update({
          where: { id: item.domainId },
          data: { status: "active" },
        });
        await logActivity({
          domainId: item.domainId,
          action: "cloudflare.active",
          message: "Cloudflare status active",
          level: "success",
        });
      } else if (domainId) {
        await logActivity({
          domainId: item.domainId,
          action: "cloudflare.refreshed",
          message: `Cloudflare status is still ${status}. Nameservers need to propagate.`,
        });
      }
    } catch (error) {
      if (domainId) throw error;
      if (syncDns) failures.push(`${item.domain.domain}: ${error instanceof Error ? error.message : "Refresh failed"}`);
    }
  }
  if (failures.length) throw new AppError({ message: `Could not refresh ${failures.length} domain(s)`, details: failures.join("; "), status: 502 });
  if (domainId && !pending.length) {
    throw new AppError({ message: "This domain is not on Cloudflare yet.", status: 400 });
  }
  return last;
}

function sameNameservers(current: string[], next: string[]) {
  const normalize = (value: string) => value.trim().replace(/\.$/, "").toLowerCase();
  const a = [...current.map(normalize)].sort();
  const b = [...next.map(normalize)].sort();
  return a.length >= 2 && a.length === b.length && a.every((item, index) => item === b[index]);
}
