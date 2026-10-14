import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { AppError, jsonError } from "@/lib/errors";
import { buyerGroupSchema } from "@/lib/validators";
import { getSpending } from "@/lib/services/spending";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  try { return Response.json({ groups: (await getSpending()).groups }); }
  catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = buyerGroupSchema.parse(await request.json());
    if (await prisma.buyerGroup.findFirst({ where: { name: { equals: body.name, mode: "insensitive" } } })) {
      throw new AppError({ message: "A group with this name already exists", status: 409 });
    }
    return Response.json({ group: await prisma.buyerGroup.create({ data: body }) });
  } catch (error) { return jsonError(error); }
}
