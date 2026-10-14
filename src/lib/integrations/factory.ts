import { decryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { CloudflareAdapter, cloudflareCredentialsSchema } from "@/lib/integrations/cloudflare/adapter";
import { HestiaAdapter, hestiaCredentialsSchema } from "@/lib/integrations/hestia/adapter";
import { KeitaroAdapter, keitaroCredentialsSchema } from "@/lib/integrations/keitaro/adapter";

export async function getCloudflare(accountId: string) {
  const account = await prisma.cloudflareAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new AppError({ message: "Cloudflare account not found", status: 404 });
  const credentials = cloudflareCredentialsSchema.parse(decryptJson(account.credentialsEncrypted));
  return { account, adapter: new CloudflareAdapter(credentials) };
}

export async function getKeitaro(serverId: string) {
  const server = await prisma.keitaroServer.findUnique({ where: { id: serverId } });
  if (!server) throw new AppError({ message: "Keitaro server not found", status: 404 });
  const credentials = keitaroCredentialsSchema.parse(decryptJson(server.credentialsEncrypted));
  return { server, adapter: new KeitaroAdapter(server.url, credentials) };
}

export async function getHestia(serverId: string) {
  const server = await prisma.hestiaServer.findUnique({ where: { id: serverId } });
  if (!server) throw new AppError({ message: "Hestia server not found", status: 404 });
  const credentials = hestiaCredentialsSchema.parse(decryptJson(server.credentialsEncrypted));
  return { server, adapter: new HestiaAdapter(server.url, credentials) };
}
