import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { settingsSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const settings = await prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
  return Response.json({ settings });
}

export async function PATCH(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = settingsSchema.parse(await request.json());
    const settings = await prisma.appSettings.upsert({
      where: { id: "default" },
      update: body,
      create: { id: "default", ...body },
    });
    return Response.json({ settings });
  } catch (error) {
    return jsonError(error);
  }
}
