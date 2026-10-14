import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { addDomainToKeitaro } from "@/lib/services/provisioning";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = z.object({ serverId: z.string(), group: z.string().nullable().optional() }).parse(await request.json());
    const result = await addDomainToKeitaro(id, body.serverId, body.group);
    return Response.json({ keitaro: result });
  } catch (error) {
    return jsonError(error);
  }
}
