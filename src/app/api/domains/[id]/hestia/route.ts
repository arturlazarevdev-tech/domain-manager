import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { addDomainToHestia } from "@/lib/services/provisioning";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = z.object({ serverId: z.string(), webUser: z.string().optional() }).parse(await request.json());
    const result = await addDomainToHestia(id, body.serverId, body.webUser);
    return Response.json({ hestia: result });
  } catch (error) {
    return jsonError(error);
  }
}
