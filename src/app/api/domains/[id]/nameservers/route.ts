import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { getRegistrar } from "@/lib/integrations/registrars/factory";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const body = z.object({ nameservers: z.array(z.string()).min(2) }).parse(await request.json());
    const domain = await prisma.domain.findUnique({ where: { id } });
    if (!domain) return Response.json({ error: { message: "Domain not found" } }, { status: 404 });
    const registrar = await getRegistrar(domain.registrarId);
    await registrar.setNameservers(domain.domain, body.nameservers);
    await prisma.domain.update({ where: { id }, data: { nameservers: body.nameservers } });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
