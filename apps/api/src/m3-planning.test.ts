/**
 * M3 resource planner against the seeded dev database: heatmap figures, competence filter, visibility and who may
 * change allocations.
 */
import { createDb } from "@arc-tid/db";
import { startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;
const monday = startOfIsoWeek(todayCopenhagen());

type Session = { cookie: string; csrf: string; id: string };
const sessions = new Map<string, Session>();
async function as(initials: string): Promise<Session> {
  const cached = sessions.get(initials);
  if (cached) return cached;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials.toLowerCase()}@demo.arcnordic.test`, password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  const me = (await app.inject({ url: "/api/v1/me", headers: { cookie } })).json();
  const s = { cookie, csrf: res.json().csrfToken as string, id: me.id as string };
  sessions.set(initials, s);
  return s;
}
const get = async (who: string, url: string) =>
  app.inject({ url, headers: { cookie: (await as(who)).cookie } });
const put = async (who: string, url: string, payload: object) => {
  const s = await as(who);
  return app.inject({ method: "PUT", url, payload, headers: { cookie: s.cookie, "x-csrf-token": s.csrf } });
};

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("resource planner", () => {
  it("shows capacity, booked hours and a band per employee per week", async () => {
    const res = (await get("AL", `/api/v1/planning?from=${monday}&weeks=4`)).json();
    expect(res.weeks).toHaveLength(4);
    const peter = res.people.find((p: { initials: string }) => p.initials === "PD");
    expect(peter.weeks[0].capacity).toBeGreaterThan(0);
    expect(["under", "ok", "over", "none"]).toContain(peter.weeks[0].band);
    expect(peter.competencies).toContain("DGNB");
  });

  it("filters by competence", async () => {
    const res = (await get("AL", `/api/v1/planning?from=${monday}&weeks=2&competence=brand`)).json();
    expect(res.people.map((p: { initials: string }) => p.initials)).toEqual(["IS"]);
  });

  it("a plain employee sees only their own row", async () => {
    const res = (await get("LV", `/api/v1/planning?from=${monday}&weeks=2`)).json();
    expect(res.people.map((p: { initials: string }) => p.initials)).toEqual(["LV"]);
  });

  it("only the project's manager, the line manager or admin may change an allocation", async () => {
    const projects = (await get("KH", "/api/v1/projects")).json();
    const holmstrup = projects.find((p: { number: string }) => p.number === "26003"); // managed by Mikkel (MB)
    const oliver = await as("OB"); // reports to Mikkel
    const body = { userId: oliver.id, projectId: holmstrup.id, weekStart: monday, hours: 5 };
    expect((await put("LV", "/api/v1/planning/allocations", body)).statusCode).toBe(403);
    expect((await put("AL", "/api/v1/planning/allocations", body)).statusCode).toBe(403);
    expect((await put("MB", "/api/v1/planning/allocations", body)).statusCode).toBe(200);
    const res = (await get("MB", `/api/v1/planning?from=${monday}&weeks=1`)).json();
    const row = res.people
      .find((p: { initials: string }) => p.initials === "OB")
      .allocations.find((a: { projectId: string }) => a.projectId === holmstrup.id);
    expect(row.hours[monday]).toBe(5);
    expect((await put("MB", "/api/v1/planning/allocations", { ...body, hours: 0 })).statusCode).toBe(200);
  });
});
