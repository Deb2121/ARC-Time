/**
 * API integration tests against the seeded dev database (`pnpm db:up && pnpm db:migrate && pnpm db:seed`).
 * Seed users (fictional): KH admin/management, JF finance, AL line manager of PD/LV/EK, LV plain employee.
 */
import { createDb } from "@arc-tid/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;

const email = (initials: string) => `${initials.toLowerCase()}@demo.arcnordic.test`;

async function login(initials: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: email(initials), password: "demo1234" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "arc_sid");
  if (!cookie) throw new Error("no session cookie");
  return { cookie: `arc_sid=${cookie.value}`, csrf: res.json().csrfToken as string };
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("health", () => {
  it("reports ready when the database is reachable", async () => {
    const res = await app.inject({ url: "/health/ready" });
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("authentication", () => {
  it("rejects requests without a session", async () => {
    const res = await app.inject({ url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong password with a generic error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/dev-login",
      payload: { email: email("LV"), password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("returns the current user with roles", async () => {
    const s = await login("AL");
    const res = await app.inject({ url: "/api/v1/me", headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().initials).toBe("AL");
    expect(res.json().roles).toEqual(expect.arrayContaining(["employee", "line_manager", "project_manager"]));
  });

  it("refuses mutating requests without the CSRF token", async () => {
    const s = await login("LV");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: s.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "csrf_failed" });
  });

  it("logs out and invalidates the session", async () => {
    const s = await login("LV");
    const out = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
    });
    expect(out.statusCode).toBe(200);
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie: s.cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("is not available when dev login is disabled", async () => {
    const prodLike = await buildApp(loadConfig({ NODE_ENV: "production", DEV_LOGIN_ENABLED: "true" }), db);
    const res = await prodLike.inject({
      method: "POST",
      url: "/api/v1/auth/dev-login",
      payload: { email: email("KH"), password: "demo1234" },
    });
    expect(res.statusCode).toBe(404);
    await prodLike.close();
  });
});

describe("people visibility (server-side RBAC)", () => {
  const initialsOf = (res: { json: () => { initials: string }[] }) =>
    res
      .json()
      .map((u) => u.initials)
      .sort();

  it("an employee sees only themselves", async () => {
    const s = await login("LV");
    const res = await app.inject({ url: "/api/v1/users", headers: { cookie: s.cookie } });
    expect(initialsOf(res)).toEqual(["LV"]);
  });

  it("a line manager sees themselves and their reports", async () => {
    const s = await login("AL");
    const res = await app.inject({ url: "/api/v1/users", headers: { cookie: s.cookie } });
    expect(initialsOf(res)).toEqual(["AL", "EK", "LV", "PD"]);
  });

  it("finance sees everyone", async () => {
    const s = await login("JF");
    const res = await app.inject({ url: "/api/v1/users", headers: { cookie: s.cookie } });
    expect(res.json()).toHaveLength(12);
  });
});

describe("role administration", () => {
  it("only admins may change roles", async () => {
    const s = await login("AL");
    const lv = (await app.inject({ url: "/api/v1/users", headers: { cookie: s.cookie } }))
      .json()
      .find((u: { initials: string }) => u.initials === "LV");
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/users/${lv.id}/roles`,
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
      payload: { roles: ["employee", "admin"] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("an admin changes roles and the change is audited", async () => {
    const s = await login("KH");
    const users = (await app.inject({ url: "/api/v1/users", headers: { cookie: s.cookie } })).json();
    const ek = users.find((u: { initials: string }) => u.initials === "EK");
    const put = (roles: string[]) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/users/${ek.id}/roles`,
        headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
        payload: { roles, reason: "test" },
      });
    const res = await put(["project_manager"]);
    expect(res.statusCode).toBe(200);
    expect(res.json().roles.sort()).toEqual(["employee", "project_manager"]);
    await put(["employee"]); // restore seed state
  });
});
