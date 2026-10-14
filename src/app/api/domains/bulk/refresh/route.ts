import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { refreshCloudflareStatus } from "@/lib/services/provisioning";

export async function POST() {
  const { response } = await requireUser();
  if (response) return response;
  try {
    await refreshCloudflareStatus(undefined, { syncDns: true, all: true });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
