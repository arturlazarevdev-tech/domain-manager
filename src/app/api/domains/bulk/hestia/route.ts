import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { deployDomainToServer } from "@/lib/services/hosting";
import { z } from "zod";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = z
      .object({
        domainIds: z.array(z.string().min(1)).min(1).max(100),
        serverId: z.string().min(1),
        cloudflareAccountId: z.string().min(1).optional(), webUser: z.string().optional(),
        ip: z.string().nullable().optional(),
      })
      .parse(await request.json());
    const results = [];
    for (const id of body.domainIds) {
      try {
        await deployDomainToServer(id, body);
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
