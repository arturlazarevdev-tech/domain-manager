import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getRegistrar } from "@/lib/integrations/registrars/factory";
import { createAndEnqueueJob } from "@/lib/jobs/queue";
import type { JobProgress, PurchaseItemProgress, PurchaseJobPayload } from "@/lib/jobs/types";
import { logActivity } from "@/lib/services/activity";
import { addDomainToCloudflare } from "@/lib/services/provisioning";
import { resolveCloudflareAccountId, resolveRegistrantContact } from "@/lib/services/settings";
import { normalizeDomain, splitDomain, registrantLabel } from "@/lib/utils";

export async function startPurchase(input: Omit<PurchaseJobPayload, "batchId" | "idempotencyKey"> & {
  idempotencyKey?: string;
}) {
  const domains = [...new Set(input.domains.map(normalizeDomain))];
  if (!domains.length) {
    throw new AppError({ message: "Select at least one domain" });
  }

  const existing = await prisma.domain.findMany({
    where: { domain: { in: domains } },
    select: { domain: true },
  });
  if (existing.length) {
    throw new AppError({
      message: "Some domains are already in the inventory",
      details: existing.map((d) => d.domain).join(", "),
    });
  }

  if (Boolean(input.buyerId) === Boolean(input.groupId)) {
    throw new AppError({ message: "Select either a buyer or a group" });
  }
  const buyer = input.buyerId
    ? await prisma.buyer.findUnique({ where: { id: input.buyerId } }) : null;
  const group = input.groupId
    ? await prisma.buyerGroup.findUnique({ where: { id: input.groupId } }) : null;
  if (input.buyerId && !buyer) throw new AppError({ message: "Buyer not found", status: 404 });
  if (input.groupId && !group) throw new AppError({ message: "Group not found", status: 404 });
  const batchId = crypto.randomUUID();
  const registrar = await getRegistrar(input.registrarId);
  const { profile: registrant } = await resolveRegistrantContact({
    registrarId: input.registrarId,
    registrantId: input.registrantId,
  });
  if (!registrant) {
    throw new AppError({
      message: "Select a registrant profile for this registrar.",
      status: 400,
    });
  }
  const cloudflareAccountId = await resolveCloudflareAccountId(input.cloudflareAccountId);
  const cloudflare = await prisma.cloudflareAccount.findUnique({ where: { id: cloudflareAccountId } });
  if (!cloudflare) throw new AppError({ message: "Cloudflare account not found", status: 404 });
  const registrarAccount = await prisma.registrarAccount.findUnique({ where: { id: input.registrarId } });

  const checks = await registrar.checkDomains(domains);
  const items: PurchaseItemProgress[] = [];

  for (const domain of domains) {
    const check = checks.find((c) => c.domain === domain);
    const lockKey = `purchase:${domain}`;
    const already = await prisma.domainPurchase.findUnique({ where: { idempotencyKey: lockKey } });
    if (already && already.status !== "failed" && already.status !== "unavailable") {
      items.push({
        domain,
        status: already.status as PurchaseItemProgress["status"],
        domainId: already.domainId ?? undefined,
        error: "Purchase already in progress or completed",
      });
      continue;
    }

    let price = check?.price?.registration.amount;
    let currency = check?.price?.registration.currency ?? "USD";
    try {
      const quoted = await registrar.getPrice(domain);
      price = quoted.registration.amount;
      currency = quoted.registration.currency;
    } catch {
      // keep availability-only
    }

    await prisma.purchaseLock.upsert({
      where: { domainName: domain },
      create: { domainName: domain },
      update: { lockedAt: new Date() },
    });

    await prisma.domainPurchase.upsert({
      where: { idempotencyKey: lockKey },
      create: {
        batchId,
        idempotencyKey: lockKey,
        domainName: domain,
        registrarId: input.registrarId,
        buyerId: input.buyerId ?? null,
        groupId: input.groupId ?? null,
        priceAmount: new Prisma.Decimal(price ?? 0),
        currency,
        status: "queued",
      },
      update: {
        buyerId: input.buyerId ?? null,
        groupId: input.groupId ?? null,
        batchId,
        status: "queued",
        errorMessage: null,
        priceAmount: new Prisma.Decimal(price ?? 0),
        currency,
      },
    });

    items.push({
      domain,
      status: "queued",
      price,
      currency,
    });
  }

  const payload: PurchaseJobPayload = {
    ...input,
    domains,
    cloudflareAccountId,
    registrarName: registrarAccount?.name,
    registrantId: registrant.id,
    registrantName: registrantLabel(registrant),
    buyerName: buyer?.name,
    groupName: group?.name,
    cloudflareName: cloudflare.name,
    batchId,
    idempotencyKey: input.idempotencyKey ?? batchId,
  };

  const job = await createAndEnqueueJob("purchase", payload);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      progress: { total: domains.length, completed: 0, items } satisfies JobProgress,
    },
  });
  await prisma.domainPurchase.updateMany({
    where: { batchId },
    data: { jobId: job.id },
  });
  await logActivity({
    jobId: job.id,
    action: "purchase.queued",
    message: `Queued ${domains.join(", ")} for purchase via ${registrarAccount?.name ?? "registrar"}`,
  });

  return { jobId: job.id, batchId, items };
}

export async function processPurchaseJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  const payload = job.payload as PurchaseJobPayload;
  const registrar = await getRegistrar(payload.registrarId);
  await logActivity({
    jobId,
    action: "purchase.started",
    message: `Starting purchase of ${payload.domains.join(", ")}`,
  });
  const { profile, contact } = await resolveRegistrantContact({
    registrarId: payload.registrarId,
    registrantId: payload.registrantId,
  });
  await logActivity({
    jobId,
    action: "purchase.registrant",
    message: profile ? `Using registrant ${profile.name}` : `Using buyer contact ${contact.name}`,
  });

  const progress: JobProgress = (job.progress as JobProgress) ?? {
    total: payload.domains.length,
    completed: 0,
    items: payload.domains.map((domain) => ({ domain, status: "queued" })),
  };

  let remainingBalance: number | null = null;
  try {
    remainingBalance = (await registrar.getBalance()).amount;
    await logActivity({
      jobId,
      action: "purchase.balance",
      message: `Registrar balance ${remainingBalance}`,
    });
  } catch {
    remainingBalance = null;
    await logActivity({
      jobId,
      action: "purchase.balance",
      message: "Could not read registrar balance; continuing without a pre-check",
      level: "warning",
    });
  }

  for (const domain of payload.domains) {
    const item = progress.items.find((i) => i.domain === domain) ?? { domain, status: "queued" };
    item.status = "purchasing";
    item.step = "Checking availability";
    await saveProgress(jobId, progress);
    await logActivity({ jobId, action: "domain.checking", message: `Checking if ${domain} is still available` });

    try {
      const availability = await registrar.checkDomain(domain);
      await logActivity({
        jobId,
        action: "domain.checked",
        message: availability.available ? `${domain} is available` : `${domain} is no longer available`,
        level: availability.available ? "info" : "warning",
      });
      if (!availability.available) {
        item.status = "unavailable";
        item.error = "Became unavailable";
        await markPurchase(domain, "unavailable", "Domain became unavailable");
        progress.completed += 1;
        await saveProgress(jobId, progress);
        continue;
      }

      item.step = "Getting price";
      await saveProgress(jobId, progress);
      const price = await registrar.getPrice(domain);
      item.price = price.registration.amount;
      item.currency = price.registration.currency;
      await logActivity({
        jobId,
        action: "domain.priced",
        message: `${domain} price is ${price.registration.amount} ${price.registration.currency}${price.promo ? " (promo)" : ""}`,
      });

      if (remainingBalance !== null && remainingBalance < price.registration.amount) {
        item.status = "failed";
        item.error = "Insufficient registrar balance";
        await markPurchase(domain, "failed", "Insufficient registrar balance");
        await logActivity({
          jobId,
          action: "domain.failed",
          message: `${domain}: insufficient registrar balance`,
          level: "error",
        });
        progress.completed += 1;
        await saveProgress(jobId, progress);
        continue;
      }

      const refs =
        ((profile?.registrarRefs as Record<string, { customerId?: string; contactId?: string } | undefined> | null) ??
          {}) as Record<string, { customerId?: string; contactId?: string }>;
      const stored = refs[payload.registrarId];
      item.step = "Buying at registrar";
      await saveProgress(jobId, progress);
      await logActivity({
        jobId,
        action: "domain.registering",
        message: `Submitting ${domain} registration to the registrar`,
      });
      const result = await registrar.registerDomain({
        domain,
        contact,
        years: 1,
        extra: stored,
      });
      if (profile && result.externalCustomerId && result.externalContactId) {
        await prisma.registrantProfile.update({
          where: { id: profile.id },
          data: {
            registrarRefs: {
              ...refs,
              [payload.registrarId]: {
                customerId: result.externalCustomerId,
                contactId: result.externalContactId,
              },
            },
          },
        });
      }
      if (remainingBalance !== null) {
        remainingBalance -= price.registration.amount;
      }

      const { tld } = splitDomain(domain);
      const saved = await prisma.domain.create({
        data: {
          domain,
          tld,
          registrarId: payload.registrarId,
          buyerId: payload.buyerId ?? null,
          groupId: payload.groupId ?? null,
          purchasePrice: new Prisma.Decimal(price.registration.amount),
          currency: price.registration.currency,
          registeredAt: result.registrationStatus === "pending" ? null : result.registeredAt ?? new Date(),
          expiresAt: result.expiresAt,
          status: result.registrationStatus ?? "purchased",
          registrarOrderId: result.orderId,
          nameservers: result.nameservers ?? [],
        },
      });

      await prisma.domainPurchase.update({
        where: { idempotencyKey: `purchase:${domain}` },
        data: { domainId: saved.id, status: result.registrationStatus ?? "purchased" },
      });

      await logActivity({
        domainId: saved.id,
        jobId,
        action: "domain.purchased",
        message: `${domain} ${result.registrationStatus === "pending" ? "registration submitted, awaiting registrar activation" : "purchased"}${result.orderId ? ` (order ${result.orderId})` : ""}`,
        level: "success",
      });

      item.domainId = saved.id;
      item.status = result.registrationStatus ?? "purchased";

      item.step = "Adding to Cloudflare";
      await saveProgress(jobId, progress);
      await logActivity({
        domainId: saved.id,
        jobId,
        action: "cloudflare.started",
        message: `Adding ${domain} to Cloudflare and updating nameservers`,
      });
      try {
        await addDomainToCloudflare(saved.id, payload.cloudflareAccountId);
        await logActivity({
          domainId: saved.id,
          jobId,
          action: "cloudflare.done",
          message: `${domain} added to Cloudflare`,
          level: "success",
        });
      } catch (error) {
        item.error = error instanceof Error ? error.message : "Cloudflare provisioning failed";
        await logActivity({
          domainId: saved.id,
          jobId,
          action: "cloudflare.failed",
          message: `${domain}: ${item.error}`,
          level: "error",
        });
      }

      item.step = "Done";
    } catch (error) {
      const details = error instanceof AppError
        ? [error.message, error.details !== error.message ? error.details : null]
            .filter(Boolean)
            .join(" ")
        : error instanceof Error
          ? error.message
          : "Purchase failed";
      item.status = "failed";
      item.error = details;
      await markPurchase(domain, "failed", details);
      await logActivity({
        jobId,
        action: "domain.failed",
        message: `${domain}: ${details}`,
        level: "error",
      });
    }

    progress.completed += 1;
    await saveProgress(jobId, progress);
    await prisma.purchaseLock.deleteMany({ where: { domainName: domain } });
  }

  const purchased = progress.items.filter((i) => i.status === "purchased").length;
  const pending = progress.items.filter((i) => i.status === "pending").length;
  const failed = progress.items.filter((i) => i.status === "failed" || i.status === "unavailable").length;
  await prisma.job.update({
    where: { id: jobId },
    data: {
      result: { purchased, pending, failed, total: progress.total },
    },
  });
  await logActivity({
    jobId,
    action: "purchase.finished",
    message: `Finished: ${purchased} purchased, ${pending} awaiting registration, ${failed} failed`,
    level: failed && !purchased ? "error" : purchased && failed ? "warning" : "success",
  });
}

async function saveProgress(jobId: string, progress: JobProgress) {
  await prisma.job.update({
    where: { id: jobId },
    data: { progress: progress as object },
  });
}

async function markPurchase(domain: string, status: string, error?: string) {
  await prisma.domainPurchase.updateMany({
    where: { idempotencyKey: `purchase:${domain}` },
    data: { status, errorMessage: error },
  });
}
