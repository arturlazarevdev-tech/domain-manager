import { requireUser } from "@/lib/api/auth";
import { jsonError } from "@/lib/errors";
import { domainManagementSchema } from "@/lib/validators";
import { updateManagedDomain } from "@/lib/services/domain-management";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    return Response.json(await updateManagedDomain(decodeURIComponent(id), domainManagementSchema.parse(await request.json())));
  } catch (error) { return jsonError(error); }
}
