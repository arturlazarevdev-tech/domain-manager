import { jsonError } from "@/lib/errors";
import { requireAdmin } from "@/lib/api/auth";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { last4, publicCloudflare } from "@/lib/serializers";
import { testAndStoreCloudflareConnection } from "@/lib/services/cloudflare";
import { cloudflareSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = cloudflareSchema.parse(await request.json());
    const existing = await prisma.cloudflareAccount.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: { message: "Not found" } }, { status: 404 });
    const current = decryptJson<{ apiToken?: string }>(existing.credentialsEncrypted);
    const token = body.apiToken?.trim() || current.apiToken || "";
    if (!token) {
      return Response.json({ error: { message: "API token is required" } }, { status: 400 });
    }
    const accountId = body.accountId.trim();
    await prisma.cloudflareAccount.update({
      where: { id },
      data: {
        name: body.name,
        accountId,
        enabled: body.enabled ?? existing.enabled,
        credentialsEncrypted: encryptJson({ apiToken: token, accountId }),
        credentialsLast4: body.apiToken?.trim() ? last4(token) : existing.credentialsLast4,
      },
    });
    const test = await testAndStoreCloudflareConnection(id);
    const saved = await prisma.cloudflareAccount.findUniqueOrThrow({ where: { id } });
    return Response.json({ account: publicCloudflare(saved), test });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  const { id } = await ctx.params;
  await prisma.cloudflareAccount.delete({ where: { id } });
  return Response.json({ ok: true });
}

export async function POST(_request: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const result = await testAndStoreCloudflareConnection(id);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
