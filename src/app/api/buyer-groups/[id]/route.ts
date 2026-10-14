import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { AppError, jsonError } from "@/lib/errors";
import { buyerGroupSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = buyerGroupSchema.parse(await request.json());
    if (await prisma.buyerGroup.findFirst({ where: { id: { not: id }, name: { equals: body.name, mode: "insensitive" } } })) {
      throw new AppError({ message: "A group with this name already exists", status: 409 });
    }
    return Response.json({ group: await prisma.buyerGroup.update({ where: { id }, data: body }) });
  } catch (error) { return jsonError(error); }
}
