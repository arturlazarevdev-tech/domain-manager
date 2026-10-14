import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getCloudflare, getKeitaro } from "@/lib/integrations/factory";
import { domainManagementSchema, manualDomainSchema, txtRecordSchema } from "@/lib/validators";
import { addDomainToCloudflare, addDomainToKeitaro, addDomainToHestia } from "./provisioning";
import { logActivity } from "./activity";
import { serializeDomain } from "@/lib/serializers";

export const managedDomainInclude = {
  registrar: true, buyer: { include: { group: true } }, buyerGroup: true,
  cloudflare: { include: { account: true } }, keitaro: { include: { server: true } }, hestia: { include: { server: true } }, dnsRecords: true,
} as const;
type Management = z.infer<typeof domainManagementSchema>;
export function normalizeManagedDomain(input: string) {
  const value = domainToASCII(input.trim().toLowerCase().replace(/\.$/, ""));
  if (!value || value.length > 253 || !value.includes(".") || value.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) {
    throw new AppError({ message: "Enter a domain name, e.g. example.com, without https:// or a path" });
  }
  return value;
}
export function txtRecordName(domain: string, input: string) {
  const value = input.trim().replace(/\.$/, "").toLowerCase();
  const full = value === "@" ? domain : value === domain || value.endsWith(`.${domain}`) ? value : `${value}.${domain}`;
  if (full.length > 253 || full.split(".").some((label) => !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label))) {
    throw new AppError({ message: "Enter @, a record label such as _acme-challenge, or a name within this domain" });
  }
  // A trailing dot explicitly denotes an absolute DNS name.
  if (input.trim().endsWith(".") && value !== domain && !value.endsWith(`.${domain}`)) throw new AppError({ message: "TXT record must belong to this domain" });
  return full;
}
async function validateReferences(input: Management) {
  if (!await prisma.registrarAccount.findUnique({ where: { id: input.registrarId } })) throw new AppError({ message: "Registrar not found", status: 404 });
  if (input.buyerId && !await prisma.buyer.findUnique({ where: { id: input.buyerId } })) throw new AppError({ message: "Buyer not found", status: 404 });
  if (input.groupId && !await prisma.buyerGroup.findUnique({ where: { id: input.groupId } })) throw new AppError({ message: "Buyer group not found", status: 404 });
  if (input.cloudflareAccountId && !await prisma.cloudflareAccount.findFirst({ where: { id: input.cloudflareAccountId, enabled: true } })) throw new AppError({ message: "Cloudflare account not found or disabled", status: 404 });
  if (input.serverIp && isIP(input.serverIp) !== 4) throw new AppError({ message: "Enter a valid IPv4 address" });
  if (input.mode === "configure" && input.serverIp && !input.cloudflareAccountId) throw new AppError({ message: "Select Cloudflare to update DNS" });
  if (input.serverType !== "none") {
    const server = input.serverType === "keitaro" ? await prisma.keitaroServer.findFirst({ where: { id: input.serverId!, enabled: true } }) : await prisma.hestiaServer.findFirst({ where: { id: input.serverId!, enabled: true } });
    if (!server) throw new AppError({ message: "Server not found or disabled", status: 404 });
    if (input.mode === "configure" && !input.cloudflareAccountId) throw new AppError({ message: "Select Cloudflare before configuring a server" });
    if (input.mode === "configure" && input.serverType === "keitaro" && isIP(input.serverIp || server.ipAddress || "") !== 4) throw new AppError({ message: "Enter an IPv4 address or set one in Settings → Servers" });
  }
}
function domainData(input: Management) {
  return { registrarId: input.registrarId, buyerId: input.buyerId ?? null, groupId: input.groupId ?? null,
    purchasePrice: new Prisma.Decimal(input.purchasePrice), currency: input.currency, registeredAt: new Date(input.purchasedAt) };
}
export async function addManualDomain(input: z.infer<typeof manualDomainSchema>) {
  const domain = normalizeManagedDomain(input.domain);
  await validateReferences(input);
  if (await prisma.domain.findUnique({ where: { domain } })) throw new AppError({ message: "This domain is already in Purchased domains", status: 409 });
  let saved;
  try { saved = await prisma.domain.create({ data: { ...domainData(input), domain, tld: domain.slice(domain.indexOf(".") + 1), status: "purchased" } }); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError({ message: "This domain is already in Purchased domains", status: 409 }); throw error; }
  await logActivity({ domainId: saved.id, action: "domain.imported", message: `Manually added ${domain}; purchase date ${input.purchasedAt}`, level: "success" });
  return configure(saved.id, input);
}
export async function updateManagedDomain(id: string, input: Management) {
  const domain = await prisma.domain.findFirst({ where: { OR: [{ id }, { domain: id }] } });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });
  await validateReferences(input);
  await prisma.domain.update({ where: { id: domain.id }, data: domainData(input) });
  await logActivity({ domainId: domain.id, action: "domain.updated", message: "Updated registrar, buyer/group, purchase date and cost" });
  return configure(domain.id, input);
}
async function configure(id: string, input: Management) {
  const warnings: string[] = [];
  try {
    let domain = await prisma.domain.findUniqueOrThrow({ where: { id }, include: { cloudflare: true } });
    if (input.mode === "existing") {
      // Record the selected server even if its API is unavailable during read-only sync.
      if (input.serverType === "keitaro") {
        const server = await prisma.keitaroServer.findUniqueOrThrow({ where: { id: input.serverId! } });
        const values = { keitaroDomainId: null, serverId: server.id, groupName: input.keitaroGroup || null, serverIp: input.serverIp || server.ipAddress, status: "not_added" as const };
        await prisma.domainKeitaro.upsert({ where: { domainId: id }, create: { domainId: id, ...values }, update: values });
        await prisma.domainHestia.deleteMany({ where: { domainId: id } });
      } else if (input.serverType === "hestia") {
        const server = await prisma.hestiaServer.findUniqueOrThrow({ where: { id: input.serverId! } });
        const values = { serverId: server.id, webUser: input.hestiaUser || server.username, ip: input.serverIp || server.ipAddress, status: "not_added" as const };
        await prisma.domainHestia.upsert({ where: { domainId: id }, create: { domainId: id, ...values }, update: values });
        await prisma.domainKeitaro.deleteMany({ where: { domainId: id } });
      }
      if (input.cloudflareAccountId) {
        await prisma.domainCloudflare.upsert({ where: { domainId: id }, create: { domainId: id, accountId: input.cloudflareAccountId, status: "not_added" }, update: domain.cloudflare?.accountId === input.cloudflareAccountId ? {} : { accountId: input.cloudflareAccountId, zoneId: null, status: "not_added", nameservers: [] } });
      }
    }
    if (input.cloudflareAccountId) {
      if (input.mode === "configure") {
        if (domain.cloudflare?.accountId !== input.cloudflareAccountId || !domain.cloudflare.zoneId) await addDomainToCloudflare(id, input.cloudflareAccountId);
      } else {
        const { adapter } = await getCloudflare(input.cloudflareAccountId);
        const zone = await adapter.getZone(domain.domain);
        await prisma.domainCloudflare.upsert({ where: { domainId: id }, create: { domainId: id, accountId: input.cloudflareAccountId, zoneId: zone?.zoneId, nameservers: zone?.nameservers ?? [], status: zone ? zone.status === "active" ? "active" : "pending" : "not_added" }, update: { accountId: input.cloudflareAccountId, zoneId: zone?.zoneId ?? null, nameservers: zone?.nameservers ?? [], status: zone ? zone.status === "active" ? "active" : "pending" : "not_added", errorMessage: null } });
        {
          const records = zone ? await adapter.listDnsRecords(zone.zoneId) : [];
          await prisma.$transaction(async (tx) => {
            await tx.domainDnsRecord.deleteMany({ where: { domainId: id } });
            if (records.length) await tx.domainDnsRecord.createMany({ data: records.map((row) => ({ domainId: id, type: row.type, name: row.name, content: row.content, proxied: row.proxied, providerId: row.id })) });
          });
        }
      }
    } else if (input.mode === "existing") {
      await prisma.$transaction([prisma.domainCloudflare.deleteMany({ where: { domainId: id } }), prisma.domainDnsRecord.deleteMany({ where: { domainId: id } })]);
    } else if (domain.cloudflare) throw new AppError({ message: "Choose the current Cloudflare account to update this domain" });
    domain = await prisma.domain.findUniqueOrThrow({ where: { id }, include: { cloudflare: true } });
    if (input.serverType === "keitaro") {
      if (input.mode === "configure") await addDomainToKeitaro(id, input.serverId!, input.keitaroGroup, input.serverIp);
      else {
        const { adapter, server } = await getKeitaro(input.serverId!);
        const remote = (await adapter.listDomains()).find((row) => row.name.toLowerCase() === domain.domain && row.status !== "deleted");
        const data = { serverId: input.serverId!, groupName: remote?.group ?? input.keitaroGroup ?? null, serverIp: input.serverIp || server.ipAddress, keitaroDomainId: remote?.id ?? null, status: remote ? "active" as const : "not_added" as const };
        await prisma.domainKeitaro.upsert({ where: { domainId: id }, create: { domainId: id, ...data }, update: data });
      }
      await prisma.domainHestia.deleteMany({ where: { domainId: id } });
    } else if (input.serverType === "hestia") {
      if (input.mode === "configure") await addDomainToHestia(id, input.serverId!, input.hestiaUser, input.serverIp);
      else {
        const server = await prisma.hestiaServer.findUniqueOrThrow({ where: { id: input.serverId! } });
        const data = { serverId: server.id, webUser: input.hestiaUser || server.username, ip: input.serverIp || server.ipAddress, status: "not_added" as const };
        await prisma.domainHestia.upsert({ where: { domainId: id }, create: { domainId: id, ...data }, update: data });
      }
      await prisma.domainKeitaro.deleteMany({ where: { domainId: id } });
    } else {
      await prisma.$transaction([prisma.domainKeitaro.deleteMany({ where: { domainId: id } }), prisma.domainHestia.deleteMany({ where: { domainId: id } })]);
      if (input.mode === "existing" && input.serverIp && !domain.cloudflare?.zoneId) {
        await prisma.domainDnsRecord.deleteMany({ where: { domainId: id, type: "A", name: "@" } });
        await prisma.domainDnsRecord.create({ data: { domainId: id, type: "A", name: "@", content: input.serverIp, proxied: false } });
      }
      if (input.mode === "configure" && input.serverIp) {
        const { pointDomainDns } = await import("./provisioning");
        await pointDomainDns(id, input.serverIp);
      }
    }
    await prisma.domain.update({ where: { id }, data: { errorMessage: null } });
  } catch (error) {
    const message = error instanceof AppError ? [error.message, error.details].filter(Boolean).join(" ") : error instanceof Error ? error.message : "Configuration failed";
    warnings.push(message);
    await prisma.domain.update({ where: { id }, data: { errorMessage: message } });
    await logActivity({ domainId: id, action: "domain.configuration_failed", message, level: "error" });
  }
  const domain = await prisma.domain.findUniqueOrThrow({ where: { id }, include: managedDomainInclude });
  return { domain: serializeDomain(domain), warnings };
}
export async function addDomainTxt(id: string, input: z.infer<typeof txtRecordSchema>) {
  const domain = await prisma.domain.findFirst({ where: { OR: [{ id }, { domain: id }] }, include: { cloudflare: true } });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });
  if (!domain.cloudflare?.zoneId) throw new AppError({ message: "Connect this domain to a Cloudflare zone before adding TXT records" });
  const name = txtRecordName(domain.domain, input.name);
  const { adapter } = await getCloudflare(domain.cloudflare.accountId);
  const existing = (await adapter.listDnsRecords(domain.cloudflare.zoneId)).find((row) => row.type === "TXT" && row.name.replace(/\.$/, "").toLowerCase() === name && row.content === input.content);
  const record = existing ?? await adapter.createDnsRecord(domain.cloudflare.zoneId, { type: "TXT", name, content: input.content, proxied: false });
  const stored = await prisma.domainDnsRecord.findFirst({ where: { domainId: domain.id, providerId: record.id } });
  const data = { domainId: domain.id, providerId: record.id, type: "TXT", name: record.name, content: record.content, proxied: false };
  if (stored) await prisma.domainDnsRecord.update({ where: { id: stored.id }, data });
  else await prisma.domainDnsRecord.create({ data });
  await logActivity({ domainId: domain.id, action: "dns.txt_added", message: `Added TXT record ${name}`, level: "success" });
  return { record };
}
