/**
 * M3 dashboard (role-based to-dos and KPIs) and weekly reminders (with a fake mailer — nothing is e-mailed).
 */
import { createDb, schema, withTenant } from "@arc-tid/db";
import { addDays, todayCopenhagen } from "@arc-tid/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { isReminderWindow, type Mailer, sendTenantReminders } from "./services/reminders.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;

async function dash(initials: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials.toLowerCase()}@demo.arcnordic.test`, password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  return (await app.inject({ url: "/api/v1/me/dashboard", headers: { cookie } })).json();
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("dashboard", () => {
  it("an employee gets personal to-dos and no company KPIs", async () => {
    // Create a draft expense so the "submit your expenses" to-do is guaranteed to exist.
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/dev-login",
      payload: { email: "lv@demo.arcnordic.test", password: "demo1234" },
    });
    const headers = {
      cookie: `arc_sid=${login.cookies.find((c) => c.name === "arc_sid")?.value}`,
      "x-csrf-token": login.json().csrfToken,
    };
    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/expenses",
      headers,
      payload: { date: todayCopenhagen(), kind: "mileage", description: "Dashboard-test", km: 1 },
    });
    const d = await dash("LV");
    expect(d.kpis).toBeNull();
    expect(d.todos.some((t: { kind: string }) => t.kind === "expenses_draft")).toBe(true);
    await app.inject({ method: "DELETE", url: `/api/v1/expenses/${draft.json().id}`, headers });
  });

  it("a line manager gets team KPIs for 12 weeks", async () => {
    const d = await dash("AL");
    expect(d.kpis.scope).toBe("team");
    expect(d.kpis.weeks).toHaveLength(12);
    expect(d.kpis.revenue).toHaveLength(0);
    const w = d.kpis.weeks.find((x: { work: number }) => x.work > 0);
    expect(w.utilisationBp).toBeGreaterThan(0);
  });

  it("finance gets company KPIs, revenue and month-close / booking to-dos", async () => {
    const d = await dash("JF");
    expect(d.kpis.scope).toBe("company");
    expect(d.kpis.revenue).toHaveLength(2);
    expect(d.todos.some((t: { kind: string }) => t.kind === "close_month")).toBe(true);
  });

  it("a project manager is warned about projects near or over budget", async () => {
    const d = await dash("NL"); // 26006 Fjordbyen is over its hour budget in the seed
    expect(
      d.todos.some(
        (t: { kind: string; ref?: string }) => t.kind === "project_budget" && t.ref?.startsWith("26006"),
      ),
    ).toBe(true);
  });
});

describe("weekly reminders", () => {
  it("runs only on Mondays from 09:00 Copenhagen time", () => {
    expect(isReminderWindow(new Date("2026-11-09T08:30:00Z"))).toBe(true); // 09:30 CET
    expect(isReminderWindow(new Date("2026-11-09T07:30:00Z"))).toBe(false); // 08:30 CET
    expect(isReminderWindow(new Date("2026-11-08T10:00:00Z"))).toBe(false); // Sunday
  });

  it("e-mails people who have not submitted last week, once", async () => {
    const [tenant] = await withTenant(db, (await firstTenant()) ?? "", (tx) =>
      tx.select().from(schema.tenants),
    );
    if (!tenant) throw new Error("no tenant");
    const sent: { to: string; subject: string }[] = [];
    const mailer: Mailer = { send: async (to, subject) => void sent.push({ to, subject }) };
    // A future Monday unique to this run, so earlier runs' log rows do not interfere.
    const monday = addDays("2031-01-06", 7 * (Date.now() % 400));
    const first = await withTenant(db, tenant.id, (tx) => sendTenantReminders(tx, tenant.id, mailer, monday));
    expect(first).toBeGreaterThan(0);
    expect(sent.every((s) => s.to.endsWith("@demo.arcnordic.test"))).toBe(true);
    const again = await withTenant(db, tenant.id, (tx) => sendTenantReminders(tx, tenant.id, mailer, monday));
    expect(again).toBe(0);
  });
});

/** The demo tenant's id (looked up via a seeded user's session). */
async function firstTenant(): Promise<string | undefined> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: "kh@demo.arcnordic.test", password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  const me = (await app.inject({ url: "/api/v1/me", headers: { cookie } })).json();
  return me.tenantId;
}
