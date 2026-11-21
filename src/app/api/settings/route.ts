import { AppError, jsonError } from "@/lib/errors";
import { requireUser, requireAdmin } from "@/lib/api/auth";
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
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const body = settingsSchema.parse(await request.json());
    const references = [
      [body.defaultBuyerId, prisma.buyer], [body.defaultRegistrarId, prisma.registrarAccount],
      [body.defaultRegistrantId, prisma.registrantProfile], [body.defaultCloudflareId, prisma.cloudflareAccount],
      [body.defaultKeitaroServerId, prisma.keitaroServer], [body.defaultHestiaServerId, prisma.hestiaServer],
    ] as const;
    for (const [id, model] of references) {
      if (id && !await (model.findUnique as typeof prisma.buyer.findUnique)({ where: { id, deletedAt: null } })) {
        throw new AppError({ message: "A selected default has been deleted. Select an existing entry.", status: 400 });
      }
    }
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
