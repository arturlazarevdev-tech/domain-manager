import { jsonError } from "@/lib/errors";
import { publicUser, requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    return Response.json({ error: { message: "User not found" } }, { status: 401 });
  }
  return Response.json({ user: publicUser(dbUser) });
}
