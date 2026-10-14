import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { getRegistrar } from "@/lib/integrations/registrars/factory";
import { resolveRegistrarId } from "@/lib/services/settings";
import { normalizeDomain } from "@/lib/utils";
import { checkBulkSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = checkBulkSchema.parse(await request.json());
    const registrarId = await resolveRegistrarId(body.registrarId);
    const registrar = await getRegistrar(registrarId);
    const domains = [...new Set(body.domains.map(normalizeDomain))];
    const results = await registrar.checkDomains(domains);
    const withPrices = await Promise.all(
      results.map(async (item) => {
        if (!item.available) return item;
        try {
          item.price = await registrar.getPrice(item.domain);
        } catch {
          return item;
        }
        return item;
      }),
    );
    const balance = await registrar.getBalance().catch(() => null);
    return Response.json({ results: withPrices, balance, registrarId });
  } catch (error) {
    return jsonError(error);
  }
}
