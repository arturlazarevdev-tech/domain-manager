import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { refreshCloudflareStatus } from "@/lib/services/provisioning";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const result = await refreshCloudflareStatus(id);
    return Response.json({ ok: true, cloudflare: result });
  } catch (error) {
    return jsonError(error);
  }
}
