import { jsonError } from "@/lib/errors";
import { requireUser } from "@/lib/api/auth";
import { encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { last4, publicServer } from "@/lib/serializers";
import { keitaroSchema } from "@/lib/validators";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  const servers = await prisma.keitaroServer.findMany({
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
    const body = keitaroSchema.parse(await request.json());
    if (!body.apiKey) {
      return Response.json({ error: { message: "API key is required" } }, { status: 400 });
    }
    const server = await prisma.keitaroServer.create({
      data: {
        name: body.name,
        url: body.url.replace(/\/$/, ""),
        ipAddress: body.ipAddress?.trim() || null,
        enabled: body.enabled ?? true,
        credentialsEncrypted: encryptJson({ apiKey: body.apiKey }),
        credentialsLast4: last4(body.apiKey),
      },
    });
    return Response.json({ server: publicServer(server) });
  } catch (error) {
    return jsonError(error);
  }
}
