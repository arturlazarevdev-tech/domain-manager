import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { last4, publicServer } from "@/lib/serializers";
import { hestiaSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const servers = await prisma.hestiaServer.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { domains: true } } },
  });
  return Response.json({
    servers: servers.map((server) => ({ ...publicServer(server), domainCount: server._count.domains })),
  });
}

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;
  try {
    const body = hestiaSchema.parse(await request.json());
    if (!body.accessKey || !body.secretKey) {
      return Response.json({ error: { message: "Access key and secret key are required" } }, { status: 400 });
    }
    const server = await prisma.hestiaServer.create({
      data: {
        name: body.name,
        url: body.url.replace(/\/$/, ""),
        username: body.username,
        ipAddress: body.ipAddress?.trim() || null,
        enabled: body.enabled ?? true,
        credentialsEncrypted: encryptJson({ accessKey: body.accessKey, secretKey: body.secretKey }),
        credentialsLast4: last4(body.secretKey),
      },
    });
    return Response.json({ server: publicServer(server) });
  } catch (error) {
    return jsonError(error);
  }
}
