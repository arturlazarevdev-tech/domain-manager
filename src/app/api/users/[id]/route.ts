import bcrypt from "bcryptjs";
import { jsonError } from "@/lib/errors";
import { publicUser, requireAdmin } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { userUpdateSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { user: admin, response } = await requireAdmin();
  if (response || !admin) return response;
  try {
    const { id } = await ctx.params;
    const body = userUpdateSchema.parse(await request.json());
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return Response.json({ error: { message: "User not found" } }, { status: 404 });

    if (body.role && body.role !== "admin" && target.role === "admin") {
      const admins = await prisma.user.count({ where: { role: "admin" } });
      if (admins <= 1) {
        return Response.json({ error: { message: "Keep at least one admin" } }, { status: 400 });
      }
    }

    if (body.email) {
      const email = body.email.trim().toLowerCase();
      const clash = await prisma.user.findFirst({ where: { email, NOT: { id } } });
      if (clash) {
        return Response.json({ error: { message: "A user with this email already exists" } }, { status: 409 });
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(body.email ? { email: body.email.trim().toLowerCase() } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 12) } : {}),
      },
    });
    return Response.json({ user: publicUser(user) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { user: admin, response } = await requireAdmin();
  if (response || !admin) return response;
  const { id } = await ctx.params;
  if (id === admin.id) {
    return Response.json({ error: { message: "You cannot delete your own account" } }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return Response.json({ error: { message: "User not found" } }, { status: 404 });
  if (target.role === "admin") {
    const admins = await prisma.user.count({ where: { role: "admin" } });
    if (admins <= 1) {
      return Response.json({ error: { message: "Keep at least one admin" } }, { status: 400 });
    }
  }
  await prisma.user.delete({ where: { id } });
  return Response.json({ ok: true });
}
