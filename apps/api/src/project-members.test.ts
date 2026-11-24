/**
 * Project members (spec projects.md S4): only members can book time, so the project manager adds and removes them.
 * Each test leaves the team as it found it (add is followed by remove); only audit rows remain.
 */
import { createDb } from "@arc-tid/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;

type Headers = Record<string, string>;
async function login(initials: string): Promise<Headers> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials}@demo.arcnordic.test`, password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  return { cookie, "x-csrf-token": res.json().csrfToken as string };
}

interface Project {
  id: string;
  managerInitials: string | null;
}
interface User {
  id: string;
  initials: string;
}
let project: Project;
let users: User[] = [];
const idOf = (initials: string) => users.find((u) => u.initials === initials)?.id as string;
const members = async (h: Headers) =>
  ((await app.inject({ url: `/api/v1/projects/${project.id}`, headers: h })).json().members as User[]).map(
    (m) => m.initials,
  );

beforeAll(async () => {
  app = await buildApp(config, db);
  const jf = await login("jf");
  users = (await app.inject({ url: "/api/v1/users", headers: jf })).json();
  const all: Project[] = (await app.inject({ url: "/api/v1/projects", headers: jf })).json();
  project = all.find((p) => p.managerInitials === "AL") as Project;
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("project members", () => {
  it("the project manager adds a person, who can then be removed again", async () => {
    const al = await login("al");
    const before = await members(al);
    const who = ["NL", "FH", "IS", "OB"].find((i) => !before.includes(i)) as string;
    const add = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/members`,
      headers: al,
      payload: { userId: idOf(who) },
    });
    expect(add.statusCode).toBe(200);
    expect(await members(al)).toContain(who);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/members/${idOf(who)}`,
      headers: al,
    });
    expect(del.statusCode).toBe(200);
    expect(await members(al)).toEqual(before);
  });

  it("refuses to remove the project manager", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/members/${idOf("AL")}`,
      headers: await login("jf"),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("member_is_manager");
  });

  it("an employee who is not the project manager may not change the team", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/members`,
      headers: await login("ob"),
      payload: { userId: idOf("OB") },
    });
    expect(res.statusCode).toBe(403);
  });
});
