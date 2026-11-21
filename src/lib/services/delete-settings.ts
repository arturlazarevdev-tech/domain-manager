import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Prisma } from "@prisma/client";

export type DeletableSetting = "buyer" | "buyerGroup" | "registrarAccount" | "registrantProfile" | "cloudflareAccount" | "keitaroServer" | "hestiaServer";

// Retain rows and foreign keys for Purchased and reports. No remote resources are deleted.
export async function deleteSetting(kind: DeletableSetting, id: string) {
  return prisma.$transaction((tx) => deleteSettingInTransaction(tx, kind, id));
}

export async function deleteSettingInTransaction(tx: Prisma.TransactionClient, kind: DeletableSetting, id: string) {
  const existing = await (tx[kind].findUnique as typeof tx.buyer.findUnique)({ where: { id } });
  if (!existing) throw new AppError({ message: "Not found", status: 404 });
  if (existing.deletedAt) return;
  // Queued operations must finish with their original configuration.
  const pending = await tx.job.findMany({ where: { status: { in: ["queued", "running"] } }, select: { payload: true } });
  const containsId = (value: unknown): boolean => value === id || (Array.isArray(value) ? value.some(containsId) : value !== null && typeof value === "object" && Object.values(value).some(containsId));
  if (pending.some((job) => containsId(job.payload))) throw new AppError({ message: "Wait for queued operations using this entry to finish before deleting it.", status: 409 });
  const deletedAt = new Date();
  switch (kind) {
    case "buyer": await tx.buyer.update({ where: { id }, data: { deletedAt, isDefault: false } }); break;
    case "buyerGroup": await tx.buyerGroup.update({ where: { id }, data: { deletedAt } }); break;
    case "registrantProfile": await tx.registrantProfile.update({ where: { id }, data: { deletedAt, isDefault: false } }); break;
    case "registrarAccount": await tx.registrarAccount.update({ where: { id }, data: { deletedAt, enabled: false } }); break;
    case "cloudflareAccount": await tx.cloudflareAccount.update({ where: { id }, data: { deletedAt, enabled: false } }); break;
    case "keitaroServer": await tx.keitaroServer.update({ where: { id }, data: { deletedAt, enabled: false } }); break;
    case "hestiaServer": await tx.hestiaServer.update({ where: { id }, data: { deletedAt, enabled: false } }); break;
  }
  const defaults = { buyer: "defaultBuyerId", registrarAccount: "defaultRegistrarId", registrantProfile: "defaultRegistrantId", cloudflareAccount: "defaultCloudflareId", keitaroServer: "defaultKeitaroServerId", hestiaServer: "defaultHestiaServerId" } as const;
  if (kind !== "buyerGroup") {
    const field = defaults[kind];
    await tx.appSettings.updateMany({ where: { [field]: id }, data: { [field]: null, ...(kind === "hestiaServer" ? { defaultHestiaUser: null } : {}) } });
  }
}
