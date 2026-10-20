import { jsonError } from "@/lib/errors";
import { requireAdmin } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { getRegistrar } from "@/lib/integrations/registrars/factory";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const registrar = await getRegistrar(id);
    const result = await registrar.testConnection();
    await prisma.registrarAccount.update({
      where: { id },
      data: {
        connectionStatus: result.ok ? "connected" : "error",
        lastError: result.ok ? null : result.message,
        lastTestedAt: new Date(),
      },
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
