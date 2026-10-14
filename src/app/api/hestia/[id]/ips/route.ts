import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { getHestia } from "@/lib/integrations/factory";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const user = new URL(request.url).searchParams.get("user") || "";
    const { adapter } = await getHestia(id);
    const ips = await adapter.listIps(user);
    return Response.json({ ips });
  } catch (error) {
    return jsonError(error);
  }
}
