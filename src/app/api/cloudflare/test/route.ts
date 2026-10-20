import { jsonError } from "@/lib/errors";
import { requireAdmin } from "@/lib/api/auth";
import { CloudflareAdapter } from "@/lib/integrations/cloudflare/adapter";
import { z } from "zod";

const testSchema = z.object({
  accountId: z.string().min(1),
  apiToken: z.string().min(1),
});

export async function POST(request: Request) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const body = testSchema.parse(await request.json());
    const adapter = new CloudflareAdapter({
      accountId: body.accountId.trim(),
      apiToken: body.apiToken.trim(),
    });
    const result = await adapter.testConnection();
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
