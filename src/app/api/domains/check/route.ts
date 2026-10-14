import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { getRegistrar } from "@/lib/integrations/registrars/factory";
import { resolveRegistrarId } from "@/lib/services/settings";
import { logActivity } from "@/lib/services/activity";
import { normalizeDomain } from "@/lib/utils";
import { checkSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = checkSchema.parse(await request.json());
    const registrarId = await resolveRegistrarId(body.registrarId);
    const registrar = await getRegistrar(registrarId);
    const domain = normalizeDomain(body.domain);
    const availability = await registrar.checkDomain(domain);
    if (availability.available) {
      try {
        availability.price = await registrar.getPrice(domain);
      } catch {
        // availability is still valid
      }
    }
    await logActivity({
      action: "domain.checked",
      message: `Domain availability checked: ${domain}`,
    });
    return Response.json({
      ...availability,
      registrarId,
      registrar: registrar.provider,
    });
  } catch (error) {
    return jsonError(error);
  }
}
