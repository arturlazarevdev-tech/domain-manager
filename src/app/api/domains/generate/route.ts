import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { generateAvailableDomains, generateDomainsSchema } from "@/lib/domain-generator";
import { getRegistrar } from "@/lib/integrations/registrars/factory";
import { resolveRegistrarId } from "@/lib/services/settings";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = generateDomainsSchema.parse(await request.json());
    const registrarId = await resolveRegistrarId(body.registrarId);
    const registrar = await getRegistrar(registrarId);
    const result = await generateAvailableDomains(registrar, { ...body, registrarId });
    const balance = await registrar.getBalance().catch(() => null);
    return Response.json({ ...result, balance, registrarId });
  } catch (error) {
    return jsonError(error);
  }
}
