import { requireUser } from "@/lib/api/auth";
import { jsonError } from "@/lib/errors";
import { configureDomainHttps } from "@/lib/services/https";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const result = await configureDomainHttps((await ctx.params).id);
    return result.ok ? Response.json(result) : Response.json({ error: { message: result.message } }, { status: 502 });
  } catch (error) { return jsonError(error); }
}
