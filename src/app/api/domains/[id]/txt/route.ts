import { requireUser } from "@/lib/api/auth";
import { jsonError } from "@/lib/errors";
import { txtRecordSchema } from "@/lib/validators";
import { addDomainTxt } from "@/lib/services/domain-management";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    return Response.json(await addDomainTxt(decodeURIComponent(id), txtRecordSchema.parse(await request.json())));
  } catch (error) { return jsonError(error); }
}
