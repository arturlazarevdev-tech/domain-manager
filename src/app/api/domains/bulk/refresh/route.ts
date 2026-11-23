import { AppError, jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { refreshDomainSelection } from "@/lib/services/bulk-refresh";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = await request.json().catch(() => { throw new AppError({ message: "Select domains to refresh or explicitly request Refresh all.", status: 400 }); });
    return Response.json(await refreshDomainSelection(body));
  } catch (error) {
    return jsonError(error);
  }
}
