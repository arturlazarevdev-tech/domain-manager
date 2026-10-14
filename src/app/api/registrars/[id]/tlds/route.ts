import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { getRegistrar } from "@/lib/integrations/registrars/factory";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const registrar = await getRegistrar(id);
    const tlds = await registrar.listTlds();
    return Response.json({ tlds });
  } catch (error) {
    return jsonError(error);
  }
}
