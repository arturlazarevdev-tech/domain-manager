import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { getRegistrar } from "@/lib/integrations/registrars/factory";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const { id } = await ctx.params;
    const registrar = await getRegistrar(id);
    const balance = await registrar.getBalance();
    await prisma.registrarAccount.update({
      where: { id },
      data: { connectionStatus: "connected", lastError: null, lastTestedAt: new Date() },
    });
    return Response.json({ balance });
  } catch (error) {
    const { id } = await ctx.params;
    await prisma.registrarAccount.update({
      where: { id },
      data: {
        connectionStatus: "error",
        lastError: error instanceof Error ? error.message : "Balance failed",
        lastTestedAt: new Date(),
      },
    }).catch(() => undefined);
    return jsonError(error);
  }
}
