import { AppError, jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { publicRegistrar } from "@/lib/serializers";
import { parseRegistrarCredentials, credentialHint } from "@/lib/integrations/registrars/credentials";
import { registrarUpsertSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = registrarUpsertSchema.parse(await request.json());
    const existing = await prisma.registrarAccount.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: { message: "Not found" } }, { status: 404 });

    if (body.provider !== existing.provider) throw new AppError({ message: "The provider of an existing account cannot be changed" });
    const current = decryptJson<Record<string, unknown>>(existing.credentialsEncrypted);
    const supplied = Object.fromEntries(Object.entries(body.credentials ?? {}).filter(([, value]) => value !== undefined && value !== ""));
    const credentials = parseRegistrarCredentials(existing.provider, { ...current, ...supplied });
    const credentialsEncrypted = encryptJson(credentials);
    const credentialsLast4 = credentialHint(credentials);

    const updated = await prisma.registrarAccount.update({
      where: { id },
      data: {
        name: body.name,
        enabled: body.enabled,
        currency: body.currency,
        defaultNameservers: body.defaultNameservers ?? existing.defaultNameservers,
        credentialsEncrypted,
        credentialsLast4,
        connectionStatus: Object.keys(supplied).length ? "unknown" : existing.connectionStatus,
        lastError: Object.keys(supplied).length ? null : existing.lastError,
      },
    });
    return Response.json({ registrar: publicRegistrar(updated) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    await prisma.registrarAccount.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
