import bcrypt from "bcryptjs";
import { jsonError } from "@/lib/errors";
import { publicUser, requireAdmin } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { userCreateSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return Response.json({ users: users.map(publicUser) });
}

export async function POST(request: Request) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const body = userCreateSchema.parse(await request.json());
    const exists = await prisma.user.findUnique({ where: { email: body.email.trim().toLowerCase() } });
    if (exists) {
      return Response.json({ error: { message: "A user with this email already exists" } }, { status: 409 });
    }
    const user = await prisma.user.create({
      data: {
        email: body.email.trim().toLowerCase(),
        name: body.name?.trim() || body.email.split("@")[0],
        role: body.role ?? "tech",
        passwordHash: await bcrypt.hash(body.password, 12),
      },
    });
    return Response.json({ user: publicUser(user) });
  } catch (error) {
    return jsonError(error);
  }
}
