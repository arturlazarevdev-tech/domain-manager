import { getSpending } from "@/lib/services/spending";
import { AppError, jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { buyerSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  try { return Response.json({ buyers: (await getSpending()).buyers }); }
  catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = buyerSchema.parse(await request.json());
    const name = body.name.trim();
    if (body.groupId && !await prisma.buyerGroup.findUnique({ where: { id: body.groupId } })) throw new AppError({ message: "Group not found", status: 404 });
    if (body.isDefault) {
      await prisma.buyer.updateMany({ data: { isDefault: false } });
    }
    const buyer = await prisma.buyer.create({
      data: {
        name,
        groupId: body.groupId ?? null,
        stageName: name,
        keitaroGroup: name,
        isDefault: body.isDefault ?? false,
      },
    });
    return Response.json({ buyer });
  } catch (error) {
    return jsonError(error);
  }
}
