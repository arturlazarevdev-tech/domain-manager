import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { addDomainToCloudflare } from "@/lib/services/provisioning";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = z.object({ accountId: z.string() }).parse(await request.json());
    const result = await addDomainToCloudflare(id, body.accountId);
    return Response.json({ cloudflare: result });
  } catch (error) {
    return jsonError(error);
  }
}
