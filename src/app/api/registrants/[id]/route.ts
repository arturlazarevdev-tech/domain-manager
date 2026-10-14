import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { registrantSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = registrantSchema.partial().parse(await request.json());
    const existing = await prisma.registrantProfile.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: { message: "Registrant not found" } }, { status: 404 });
    const registrarId = body.registrarId ?? existing.registrarId;
    if (body.isDefault && registrarId) {
      await prisma.registrantProfile.updateMany({
        where: { registrarId, NOT: { id } },
        data: { isDefault: false },
      });
    }
    const registrant = await prisma.registrantProfile.update({
      where: { id },
      data: body,
      include: { registrar: { select: { id: true, name: true } } },
    });
    return Response.json({ registrant });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  const { id } = await ctx.params;
  await prisma.registrantProfile.delete({ where: { id } });
  return Response.json({ ok: true });
}
