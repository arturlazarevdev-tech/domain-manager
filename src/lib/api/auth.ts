import { readSession, type SessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function requireUser() {
  const user = await readSession();
  if (!user) {
    return { user: null, response: Response.json({ error: { message: "Unauthorized" } }, { status: 401 }) };
  }
  return { user, response: null };
}

export async function requireAdmin() {
  const { user, response } = await requireUser();
  if (response || !user) return { user: null, dbUser: null, response: response };
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || dbUser.role !== "admin") {
    return {
      user: null,
      dbUser: null,
      response: Response.json({ error: { message: "Admin only" } }, { status: 403 }),
    };
  }
  return { user, dbUser, response: null };
}

export function publicUser(user: { id: string; email: string; name: string | null; role: string; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
    createdAt: user.createdAt,
  };
}
