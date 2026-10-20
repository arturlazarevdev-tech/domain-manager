import { detailedErrorMessage, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { addDomainToKeitaro } from "@/lib/services/provisioning";
import { z } from "zod";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = z
      .object({ domainIds: z.array(z.string()), serverId: z.string(), group: z.string().nullable().optional() })
      .parse(await request.json());
    const results = [];
    const names = new Map((await prisma.domain.findMany({ where: { id: { in: body.domainIds } }, select: { id: true, domain: true } })).map((item) => [item.id, item.domain]));
    for (const id of body.domainIds) {
      try {
        await addDomainToKeitaro(id, body.serverId, body.group);
        results.push({ id, domain: names.get(id), ok: true });
      } catch (error) {
        results.push({ id, domain: names.get(id), ok: false, error: detailedErrorMessage(error, "Failed") });
      }
    }
    return Response.json({ results });
  } catch (error) {
    return jsonError(error);
  }
}
