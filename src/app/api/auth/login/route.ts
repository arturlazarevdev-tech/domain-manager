import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSessionToken, setSessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: { message: "Email and password are required" } }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ error: { message: "Invalid email or password" } }, { status: 401 });
  }

  const token = await createSessionToken({ id: user.id, email: user.email, name: user.name, role: user.role });
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
