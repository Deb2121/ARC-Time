/**
 * Changing a person's line manager (who approves their timesheets) via PATCH /admin/employees/:id.
 * Only refusals are exercised, so the demo database is unchanged.
 */
import { createDb } from "@arc-tid/db";
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
const patch = (h: Record<string, string>, id: string, payload: object) =>
  app.inject({ method: "PATCH", url: `/api/v1/admin/employees/${id}`, headers: h, payload });

let users: { id: string; initials: string; managerId: string | null }[] = [];
const idOf = (initials: string) => users.find((u) => u.initials === initials)?.id as string;

beforeAll(async () => {
  app = await buildApp(config, db);
  const kh = await login("kh");
  users = (await app.inject({ url: "/api/v1/users", headers: kh })).json();
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("line manager change", () => {
  it("refuses the person as their own manager", async () => {
    const res = await patch(await login("kh"), idOf("EK"), { managerId: idOf("EK") });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("manager_self");
  });

  it("refuses a loop in the chain (Anne leads Emil, so Emil cannot lead Anne)", async () => {
    expect(users.find((u) => u.initials === "EK")?.managerId).toBe(idOf("AL"));
    const res = await patch(await login("kh"), idOf("AL"), { managerId: idOf("EK") });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("manager_cycle");
  });

  it("is Admin only — Finance may not change who approves", async () => {
    const res = await patch(await login("jf"), idOf("EK"), { managerId: idOf("MB") });
    expect(res.statusCode).toBe(403);
  });
});
