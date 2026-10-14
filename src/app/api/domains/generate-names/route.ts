import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { generateCandidateNames, generateDomainsSchema } from "@/lib/domain-generator";

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = generateDomainsSchema.parse(await request.json());
    const domains = await generateCandidateNames(body);
    return Response.json({ domains });
  } catch (error) {
    return jsonError(error);
  }
}
