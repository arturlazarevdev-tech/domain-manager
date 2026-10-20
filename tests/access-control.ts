import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

loadEnvConfig(process.cwd());
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const fixtures: string[] = [];

async function main() {
  async function createUser(role: "admin" | "tech") {
    const user = await db.user.create({ data: {
      email: `access-${crypto.randomUUID()}@example.invalid`, passwordHash: "test-no-login", role,
    } });
    fixtures.push(user.id);
    // Deliberately claim admin in both JWTs: authorization must use the database role.
    return new SignJWT({ id: user.id, email: user.email, role: "admin" })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  }
  const tech = await createUser("tech");
  const admin = await createUser("admin");
  async function request(path: string, token?: string, method = "GET", body?: object) {
    return fetch(base + path, { method, redirect: "manual",
      headers: { ...(token ? { cookie: `dm_session=${token}` } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const families = ["buyers", "buyer-groups", "registrars", "registrants", "cloudflare", "keitaro", "hestia"];
  const mutations: Array<[string, string]> = families.flatMap((family) => [
    [`/api/${family}`, "POST"], [`/api/${family}/missing-access-test`, "PATCH"],
    ...(family === "buyer-groups" ? [] : [[`/api/${family}/missing-access-test`, "DELETE"]]),
  ] as Array<[string, string]>);
  mutations.push(["/api/settings", "PATCH"], ["/api/cloudflare/test", "POST"],
    ["/api/registrars/missing-access-test/test", "POST"],
    ...["cloudflare", "keitaro", "hestia"].map((family) => [`/api/${family}/missing-access-test`, "POST"] as [string, string]),
    ["/api/users", "POST"], ["/api/users/missing-access-test", "PATCH"], ["/api/users/missing-access-test", "DELETE"]);
  for (const [path, method] of mutations) {
    assert.equal((await request(path, tech, method, {})).status, 403, `${method} ${path}: tech denied`);
    assert.equal((await request(path, undefined, method, {})).status, 401, `${method} ${path}: anonymous denied`);
  }
  for (const family of [...families, "settings"]) {
    assert.equal((await request(`/api/${family}`, tech)).status, 200, `${family}: purchase options available`);
  }
  for (const token of [tech, admin]) {
    // Invalid input cannot buy a domain, but reaching validation proves both roles are authorized.
    assert.equal((await request("/api/domains/purchase", token, "POST", {})).status, 400);
  }
  const group = await request("/api/buyer-groups", admin, "POST", { name: `Access test ${crypto.randomUUID()}` });
  assert.equal(group.status, 200, "admin can create settings");
  const groupId = (await group.json()).group.id;
  try {
    assert.equal((await request(`/api/buyer-groups/${groupId}`, admin, "PATCH", { name: `Renamed ${crypto.randomUUID()}` })).status, 200);
    await db.user.update({ where: { id: fixtures[1] }, data: { role: "tech" } });
    assert.equal((await request(`/api/buyer-groups/${groupId}`, admin, "PATCH", { name: "Denied" })).status, 403, "demotion revokes access immediately");
    await db.user.update({ where: { id: fixtures[1] }, data: { role: "admin" } });
    for (const path of ["/settings", "/settings/buyers", "/settings/servers", "/infrastructure", "/infrastructure/cloudflare"]) {
      const denied = await request(path, tech);
      assert([307, 308].includes(denied.status) && denied.headers.get("location") === "/", `${path}: direct navigation denied`);
      assert.equal((await request(path, admin)).status, 200, `${path}: admin allowed`);
    }
  } finally { await db.buyerGroup.delete({ where: { id: groupId } }); }
  console.log(`PASS: ${mutations.length} admin operations denied to tech and anonymous; purchase options, both purchase roles, admin edits, role demotion and direct page protection.`);
}

main().finally(async () => {
  if (fixtures.length) await db.user.deleteMany({ where: { id: { in: fixtures } } });
  await db.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
