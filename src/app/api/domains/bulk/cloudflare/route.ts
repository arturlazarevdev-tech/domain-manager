import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { addDomainToCloudflare } from "@/lib/services/provisioning";
import { z } from "zod";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = z.object({ domainIds: z.array(z.string()), accountId: z.string() }).parse(await request.json());
    const results = [];
    for (const id of body.domainIds) {
      try {
        await addDomainToCloudflare(id, body.accountId);
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
