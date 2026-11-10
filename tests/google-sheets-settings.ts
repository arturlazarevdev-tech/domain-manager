import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { prisma } from "../src/lib/db";
import { decryptJson } from "../src/lib/crypto";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3001";
async function main() {
  const previous = await prisma.googleSheetsReportSettings.findUnique({ where: { id: "default" } });
  const user = await prisma.user.create({ data: { email: `sheets-test-${crypto.randomUUID()}@example.invalid`, passwordHash: "test-only", role: "admin" } });
  const token = await new SignJWT({ id: user.id, email: user.email, role: "admin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const request = (method: string, data?: object, path = "/api/settings/google-sheets") => fetch(base + path, { method, headers: { cookie: `dm_session=${token}`, "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  try {
    await prisma.googleSheetsReportSettings.deleteMany();
    const target = { spreadsheetId: "example_spreadsheet_for_local_test", enabled: true };
    assert.equal((await request("PATCH", target)).status, 400, "cannot enable without credentials");
    const credentials = { type: "service_account", client_email: "unit@example.iam.gserviceaccount.com", private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://untrusted.invalid" };
    const saved = await request("PATCH", { ...target, enabled: false, credentialsJson: JSON.stringify(credentials) });
    assert.equal(saved.status, 200);
    const responseText = await saved.text();
    assert(!responseText.includes("PRIVATE KEY") && !responseText.includes("credentialsEncrypted"));
    const row = await prisma.googleSheetsReportSettings.findUniqueOrThrow({ where: { id: "default" } });
    assert(row.credentialsEncrypted && !row.credentialsEncrypted.includes("PRIVATE KEY"));
    const decrypted = decryptJson<Record<string, string>>(row.credentialsEncrypted);
    assert.equal(decrypted.private_key, credentials.private_key);
    assert(!("token_uri" in decrypted), "untrusted token endpoints stripped");
    assert.equal((await request("PATCH", { ...target, credentialsJson: "" })).status, 200, "blank key preserves saved credentials");
    assert.equal((await prisma.googleSheetsReportSettings.findUniqueOrThrow({ where: { id: "default" } })).credentialsEncrypted, row.credentialsEncrypted);
    const generic = await (await request("GET", undefined, "/api/settings")).text();
    assert(!generic.includes("credentialsEncrypted") && !generic.includes("PRIVATE KEY"));
    console.log("PASS: configuration validation, encrypted storage, secret redaction, safe token endpoint, blank-key preservation.");
  } finally {
    await prisma.googleSheetsReportSettings.deleteMany();
    if (previous) await prisma.googleSheetsReportSettings.create({ data: previous });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch(() => { console.error("Google Sheets settings test failed"); process.exitCode = 1; });
