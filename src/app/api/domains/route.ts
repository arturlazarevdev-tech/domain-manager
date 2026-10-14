import { addManualDomain } from "@/lib/services/domain-management";
import { manualDomainSchema } from "@/lib/validators";
import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { serializeDomain } from "@/lib/serializers";

const domainInclude = {
  registrar: true,
  buyer: { include: { group: true } },
  buyerGroup: true,
  cloudflare: { include: { account: true } },
  keitaro: { include: { server: true } },
  hestia: { include: { server: true } },
  dnsRecords: true,
} as const;

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const domains = await prisma.domain.findMany({
      orderBy: { createdAt: "desc" },
      include: domainInclude,
    });
    return Response.json({
      domains: domains.map(serializeDomain),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = manualDomainSchema.parse(await request.json());
    return Response.json(await addManualDomain(body));
  } catch (error) { return jsonError(error); }
}
