import { writeFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/db';
import { getRegistrar } from '../src/lib/integrations/registrars/factory';
import { RegwayAdapter } from '../src/lib/integrations/registrars/regway/adapter';

async function main() {
  const registrarId = process.env.RECONCILE_REGISTRAR_ID;
  if (!registrarId) throw new Error('RECONCILE_REGISTRAR_ID is required');
  const registrar = await getRegistrar(registrarId);
  if (!(registrar instanceof RegwayAdapter)) throw new Error('Only Regway is supported');
  const domains = await prisma.domain.findMany({ where: { registrarId, tld: 'digital', status: { notIn: ['failed', 'pending'] } } });
  const plan: { id: string; domain: string; previous: string; previousCurrency: string; amount: number; currency: string }[] = [];
  for (let offset = 0; offset < domains.length; offset += 3) {
    const batch = await Promise.all(domains.slice(offset, offset + 3).map(async domain => {
      const charge = await registrar.getRegistrationCharge(domain.domain, 1, domain.registeredAt ? domain.registeredAt.getTime() - 86400000 : undefined);
      if (!charge) { console.log(`SKIP: no matching invoice for ${domain.domain}`); return null; }
      if (Number(domain.purchasePrice) === charge.amount && domain.currency === charge.currency) return null;
      return { id: domain.id, domain: domain.domain, previous: String(domain.purchasePrice), previousCurrency: domain.currency, ...charge };
    }));
    plan.push(...batch.filter((row): row is NonNullable<typeof row> => row !== null));
  }
  const purchases = await prisma.domainPurchase.findMany({ where: { domainId: { in: plan.map(row => row.id) } } });
  const jobs = await prisma.job.findMany({ where: { id: { in: [...new Set(purchases.flatMap(row => row.jobId ? [row.jobId] : []))] } } });
  writeFileSync('/tmp/regway-pricing-reconciliation.json', JSON.stringify({ createdAt: new Date(), registrarId, plan, purchases, jobs }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ checked: domains.length, changes: plan }));
  if (!process.argv.includes('--apply')) return;
  await prisma.$transaction(async tx => {
    for (const row of plan) {
      const updated = await tx.domain.updateMany({ where: { id: row.id, purchasePrice: new Prisma.Decimal(row.previous), currency: row.previousCurrency }, data: { purchasePrice: new Prisma.Decimal(row.amount), currency: row.currency } });
      if (updated.count !== 1) throw new Error(`Price changed during reconciliation: ${row.domain}`);
      await tx.domainPurchase.updateMany({ where: { domainId: row.id, status: { in: ['purchased', 'active'] } }, data: { priceAmount: new Prisma.Decimal(row.amount), currency: row.currency } });
      await tx.activityLog.create({ data: { domainId: row.id, action: 'purchase.price_reconciled', message: `Registration cost corrected from ${row.previous} ${row.previousCurrency} to ${row.amount} ${row.currency}, verified against the Regway reseller invoice.`, level: 'info' } });
    }
    for (const job of jobs) {
      const progress = job.progress as { items?: { domain: string; price?: number; currency?: string }[] } | null;
      if (!progress?.items) continue;
      for (const item of progress.items) {
        const row = plan.find(row => row.domain === item.domain);
        if (row) { item.price = row.amount; item.currency = row.currency; }
      }
      await tx.job.update({ where: { id: job.id }, data: { progress: progress as Prisma.InputJsonValue } });
    }
  });
  console.log(`APPLIED: ${plan.length} invoice-verified corrections`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
