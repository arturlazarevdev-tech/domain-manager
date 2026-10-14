import { AppError, jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { buyerSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = buyerSchema.partial().parse(await request.json());
    if (body.groupId && !await prisma.buyerGroup.findUnique({ where: { id: body.groupId } })) throw new AppError({ message: "Group not found", status: 404 });
    if (body.isDefault) {
      await prisma.buyer.updateMany({ data: { isDefault: false } });
    }
    const name = body.name?.trim();
    const buyer = await prisma.buyer.update({
      where: { id },
      data: {
        ...(body.groupId !== undefined ? { groupId: body.groupId } : {}),
        ...(name
          ? { name, stageName: name, keitaroGroup: name }
          : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      },
    });
    return Response.json({ buyer });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  await prisma.buyer.delete({ where: { id } });
  return Response.json({ ok: true });
}
