import { z } from "zod";
import { importPKCS8 } from "jose";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/api/auth";
import { encryptJson } from "@/lib/crypto";
import { AppError, jsonError } from "@/lib/errors";
import { serviceAccountSchema } from "@/lib/reports/google-sheets";
import { previewReport, sendWeeklyReport } from "@/lib/reports/service";

const publicFields = { spreadsheetId: true, serviceAccountEmail: true, enabled: true, lastAttemptAt: true, lastSuccessAt: true, lastReportWeek: true, lastSheetId: true, lastDomainCount: true, lastError: true } as const;
export async function GET() {
  const { response } = await requireAdmin(); if (response) return response;
  try {
    const settings = await prisma.googleSheetsReportSettings.findUnique({ where: { id: "default" }, select: publicFields });
    const { week, count, totals } = await previewReport();
    return Response.json({ settings, preview: { start: week.startDay, end: week.lastDay, count, totals } });
  } catch (error) { return jsonError(error); }
}
export async function PATCH(request: Request) {
  const { response } = await requireAdmin(); if (response) return response;
  try {
    const data = z.object({ spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]{20,200}$/), enabled: z.boolean(), credentialsJson: z.string().max(20000).optional() }).parse(await request.json());
    let credentialsEncrypted: string | undefined;
    let serviceAccountEmail: string | undefined;
    if (data.credentialsJson?.trim()) {
      let json: unknown;
      try { json = JSON.parse(data.credentialsJson); } catch { throw new AppError({ message: "Invalid service account JSON" }); }
      const credentials = serviceAccountSchema.parse(json);
      try { await importPKCS8(credentials.private_key, "RS256"); } catch { throw new AppError({ message: "Invalid Google private key" }); }
      credentialsEncrypted = encryptJson(credentials);
      serviceAccountEmail = credentials.client_email;
    }
    const current = await prisma.googleSheetsReportSettings.findUnique({ where: { id: "default" } });
    if (data.enabled && !credentialsEncrypted && !current?.credentialsEncrypted) throw new AppError({ message: "Add a service account key before enabling reports" });
    const update = { spreadsheetId: data.spreadsheetId, enabled: data.enabled, credentialsEncrypted, serviceAccountEmail,
      ...(current && current.spreadsheetId !== data.spreadsheetId ? { lastSuccessAt: null, lastReportWeek: null, lastSheetId: null, lastDomainCount: null, lastError: null } : {}),
    };
    const settings = await prisma.googleSheetsReportSettings.upsert({ where: { id: "default" }, create: update, update, select: publicFields });
    return Response.json(settings);
  } catch (error) { return jsonError(error); }
}
export async function POST() {
  const { response } = await requireAdmin(); if (response) return response;
  try { return Response.json(await sendWeeklyReport()); } catch (error) { return jsonError(error); }
}
