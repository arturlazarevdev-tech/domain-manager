import { prisma } from "@/lib/db";
import { AppError, detailedErrorMessage } from "@/lib/errors";
import { getCloudflare } from "@/lib/integrations/factory";
import { logActivity } from "./activity";

// Configures the visitor redirect at Cloudflare. Certificate issuance and DNS
// propagation remain asynchronous; origin SSL modes are never downgraded here.
export async function configureDomainHttps(domainId: string) {
  const domain = await prisma.domain.findUnique({ where: { id: domainId }, include: { cloudflare: true } });
  if (!domain) throw new AppError({ message: "Domain not found", status: 404 });
  try {
    if (!domain.cloudflare?.zoneId) throw new AppError({ message: "Connect this domain to Cloudflare before enabling HTTPS" });
    const { adapter, account } = await getCloudflare(domain.cloudflare.accountId);
    if (!account.enabled) throw new AppError({ message: "The Cloudflare account is disabled" });
    const records = await adapter.listDnsRecords(domain.cloudflare.zoneId);
    const root = records.filter(r => ["A", "AAAA", "CNAME"].includes(r.type) && ["@", "www", domain.domain, `www.${domain.domain}`].includes(r.name));
    if (root.some(r => !r.proxied)) throw new AppError({ message: "Cloudflare HTTPS redirects require proxied DNS. This domain uses DNS-only records: configure a certificate and redirect on its hosting server, or enable Cloudflare proxy." });
    const result = await adapter.enableHttps(domain.cloudflare.zoneId);
    const configuredAt = domain.httpsConfiguredAt ?? new Date();
    await prisma.domain.update({ where: { id: domainId }, data: { httpsConfiguredAt: configuredAt, httpsError: null } });
    if (result.changed || !domain.httpsConfiguredAt || domain.httpsError) await logActivity({ domainId, action: "https.configured", message: "Cloudflare HTTP → HTTPS redirect configured. HTTPS becomes available after DNS activation and certificate issuance.", level: "success" });
    return { ok: true as const, configuredAt };
  } catch (error) {
    const message = detailedErrorMessage(error, "HTTPS configuration failed");
    await prisma.domain.update({ where: { id: domainId }, data: { httpsError: message } });
    if (domain.httpsError !== message) await logActivity({ domainId, action: "https.failed", message, level: "warning" });
    return { ok: false as const, message };
  }
}
