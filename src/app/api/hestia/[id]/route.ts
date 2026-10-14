import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getHestia } from "@/lib/integrations/factory";
import { last4, publicServer } from "@/lib/serializers";
import { hestiaSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = hestiaSchema.parse(await request.json());
    const existing = await prisma.hestiaServer.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: { message: "Not found" } }, { status: 404 });
    const current = decryptJson<{ accessKey: string; secretKey: string }>(existing.credentialsEncrypted);
    const accessKey = body.accessKey || current.accessKey;
    const secretKey = body.secretKey || current.secretKey;
    const server = await prisma.hestiaServer.update({
      where: { id },
      data: {
        name: body.name,
        url: body.url.replace(/\/$/, ""),
        username: body.username,
        ipAddress: body.ipAddress?.trim() || existing.ipAddress,
        enabled: body.enabled ?? existing.enabled,
        credentialsEncrypted: encryptJson({ accessKey, secretKey }),
        credentialsLast4: body.secretKey ? last4(body.secretKey) : existing.credentialsLast4,
      },
    });
    return Response.json({ server: publicServer(server) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  await prisma.hestiaServer.delete({ where: { id } });
  return Response.json({ ok: true });
}

export async function POST(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const { adapter } = await getHestia(id);
    const result = await adapter.testConnection();
    await prisma.hestiaServer.update({
      where: { id },
      data: {
        connectionStatus: result.ok ? "connected" : "error",
        lastError: result.ok ? null : result.message,
        lastTestedAt: new Date(),
      },
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
