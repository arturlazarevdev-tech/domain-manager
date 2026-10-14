import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { registrantSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const registrants = await prisma.registrantProfile.findMany({
    orderBy: { createdAt: "asc" },
    include: { registrar: { select: { id: true, name: true } } },
  });
  return Response.json({ registrants });
}

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = registrantSchema.parse(await request.json());
    const registrar = await prisma.registrarAccount.findUnique({ where: { id: body.registrarId } });
    if (!registrar) {
      return Response.json({ error: { message: "Registrar not found" } }, { status: 404 });
    }
    if (body.isDefault) {
      await prisma.registrantProfile.updateMany({
        where: { registrarId: body.registrarId },
        data: { isDefault: false },
      });
    }
    const registrant = await prisma.registrantProfile.create({
      data: {
        ...body,
        isDefault: body.isDefault ?? false,
      },
      include: { registrar: { select: { id: true, name: true } } },
    });
    return Response.json({ registrant });
  } catch (error) {
    return jsonError(error);
  }
}
