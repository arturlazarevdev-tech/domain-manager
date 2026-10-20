import { jsonError } from "@/lib/errors";
import { requireUser, requireAdmin } from "@/lib/api/auth";
import { encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { last4, publicCloudflare } from "@/lib/serializers";
import { testAndStoreCloudflareConnection } from "@/lib/services/cloudflare";
import { cloudflareSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const accounts = await prisma.cloudflareAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { domains: true } } },
  });
  return Response.json({
    accounts: accounts.map((account) => ({
      ...publicCloudflare(account),
      domainCount: account._count.domains,
      zoneCount: account._count.domains,
    })),
  });
}

export async function POST(request: Request) {
  const { response } = await requireAdmin();
  if (response) return response;
  try {
    const body = cloudflareSchema.parse(await request.json());
    if (!body.apiToken) {
      return Response.json({ error: { message: "API token is required" } }, { status: 400 });
    }
    const token = body.apiToken.trim();
    const accountId = body.accountId.trim();
    const account = await prisma.cloudflareAccount.create({
      data: {
        name: body.name,
        accountId,
        enabled: body.enabled ?? true,
        credentialsEncrypted: encryptJson({ apiToken: token, accountId }),
        credentialsLast4: last4(token),
      },
    });
    const test = await testAndStoreCloudflareConnection(account.id);
    const saved = await prisma.cloudflareAccount.findUniqueOrThrow({ where: { id: account.id } });
    return Response.json({ account: publicCloudflare(saved), test });
  } catch (error) {
    return jsonError(error);
  }
}
