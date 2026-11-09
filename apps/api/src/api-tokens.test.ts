/** Personal API tokens for Power BI / Excel (D-028): who may create them, shown once, stored hashed, revocable. */
import { createDb, schema, withTenant } from "@arc-tid/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;

async function login(initials: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials}@demo.arcnordic.test`, password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  return { cookie, "x-csrf-token": res.json().csrfToken as string };
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("API tokens", () => {
  it("employees cannot create tokens", async () => {
    const h = await login("lv");
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/api-tokens", headers: h, payload: { name: "x1" } }))
        .statusCode,
    ).toBe(403);
  });

  it("Finance creates a token that is shown once, stored only as a hash, and can be revoked", async () => {
    const h = await login("jf");
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/v1/api-tokens",
        headers: h,
        payload: { name: "Test-nøgle" },
      })
    ).json();
    expect(created.token).toMatch(/^arct_[\w-]{40,}$/);
    const list = (await app.inject({ url: "/api/v1/api-tokens", headers: h })).json();
    const row = list.find((t: { id: string }) => t.id === created.id);
    expect(row.prefix).toBe(created.token.slice(0, 9));
    expect(JSON.stringify(list)).not.toContain(created.token);
    const [stored] = await withTenant(
      db,
      (await app.inject({ url: "/api/v1/me", headers: h })).json().tenantId,
      (tx) => tx.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, created.id)),
    );
    expect(stored?.tokenHash).not.toContain(created.token);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/v1/api-tokens/${created.id}`, headers: h }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/v1/api-tokens/${created.id}`, headers: h }))
        .statusCode,
    ).toBe(404);
  });
});
