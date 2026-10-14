import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { startPurchase } from "@/lib/services/purchase";
import { purchaseSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = purchaseSchema.parse(await request.json());
    const result = await startPurchase(body);
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
