import { prisma } from "./lib/db";
import { configureDomainHttps } from "./lib/services/https";

// Dry-run by default. Applies only HTTPS settings to existing purchased domains;
// never registers domains, changes DNS, or changes Cloudflare's origin SSL mode.
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== "--apply" && !a.startsWith("--domain="))) throw new Error("Usage: configure-https.ts [--apply] [--domain=example.com]");
  const only = args.find(a => a.startsWith("--domain="))?.slice(9);
  const domains = await prisma.domain.findMany({ where: {
    status: { in: ["purchased", "active"] }, ...(only ? { domain: only } : {}),
    cloudflare: { zoneId: { not: null }, account: { deletedAt: null, enabled: true } },
  }, include: { cloudflare: true }, orderBy: { createdAt: "desc" } });
  if (!args.includes("--apply")) { console.log(JSON.stringify({ dryRun: true, count: domains.length, domains: domains.map(d => d.domain) })); return; }
  const blocked = new Map<string, string>();
  let configured = 0, failed = 0;
  for (const domain of domains) {
    const accountId = domain.cloudflare!.accountId;
    const knownError = blocked.get(accountId);
    if (knownError) {
      await prisma.domain.update({ where: { id: domain.id }, data: { httpsError: knownError } });
      failed++; continue;
    }
    const result = await configureDomainHttps(domain.id);
    if (result.ok) configured++;
    else {
      failed++;
      if (result.message.includes("Zone Settings → Edit")) blocked.set(accountId, result.message);
      console.log(JSON.stringify({ domain: domain.domain, error: result.message }));
    }
  }
  console.log(JSON.stringify({ total: domains.length, configured, failed, accountsNeedingPermissions: blocked.size }));
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
