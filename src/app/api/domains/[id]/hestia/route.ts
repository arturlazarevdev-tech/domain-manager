import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { deployDomainToServer } from "@/lib/services/hosting";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = z.object({ serverId: z.string().min(1), cloudflareAccountId: z.string().min(1).optional(), webUser: z.string().optional() }).parse(await request.json());
    const result = await deployDomainToServer(id, body);
    return Response.json({ hestia: result, hosting: result });
  } catch (error) {
    return jsonError(error);
  }
}
