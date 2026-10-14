import { jsonError } from "@/lib/errors";
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
    for (const id of body.domainIds) {
      try {
        await addDomainToKeitaro(id, body.serverId, body.group);
        results.push({ id, ok: true });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    }
    return Response.json({ results });
  } catch (error) {
    return jsonError(error);
  }
}
