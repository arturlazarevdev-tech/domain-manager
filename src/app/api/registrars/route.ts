import { jsonError } from "@/lib/errors";
import { requireUser, requireAdmin } from "@/lib/api/auth";
import { encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { publicRegistrar } from "@/lib/serializers";
import { parseRegistrarCredentials, credentialHint } from "@/lib/integrations/registrars/credentials";
import { registrarUpsertSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const registrars = await prisma.registrarAccount.findMany({ orderBy: { createdAt: "asc" } });
    return Response.json({ registrars: registrars.map(publicRegistrar) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const body = registrarUpsertSchema.parse(await request.json());
    const credentials = parseRegistrarCredentials(body.provider, body.credentials ?? {});
    const created = await prisma.registrarAccount.create({
      data: {
        name: body.name,
        provider: body.provider,
        currency: body.currency,
        enabled: body.enabled,
        defaultNameservers: body.defaultNameservers ?? [],
        credentialsEncrypted: encryptJson(credentials),
        credentialsLast4: credentialHint(credentials),
      },
    });
    return Response.json({ registrar: publicRegistrar(created) });
  } catch (error) {
    return jsonError(error);
  }
}
