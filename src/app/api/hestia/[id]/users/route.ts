import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { getHestia } from "@/lib/integrations/factory";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const { adapter } = await getHestia(id);
    const users = await adapter.listUsers();
    return Response.json({ users });
  } catch (error) {
    return jsonError(error);
  }
}
