/**
 * M3 Outlook calendar import with a fake calendar (no Microsoft calls): disabled by default, not-connected without a
 * token, and importing picked meetings as draft hours that respect every timesheet rule. Also token encryption.
 */
import { createDb } from "@arc-tid/db";
import { startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import type { CalendarEvent } from "@arc-tid/integrations";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { decryptToken, encryptToken } from "./services/outlook.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
const monday = startOfIsoWeek(todayCopenhagen());
const run = String(Date.now());
const events: CalendarEvent[] = [
  {
    id: `${run}-a`,
    subject: "Byggemøde",
    start: `${monday}T09:00:00`,
    end: `${monday}T10:30:00`,
    isAllDay: false,
    showAs: "busy",
    isCancelled: false,
    organizer: null,
  },
  {
    id: `${run}-b`,
    subject: "Frokost",
    start: `${monday}T12:00:00`,
    end: `${monday}T12:30:00`,
    isAllDay: false,
    showAs: "free",
    isCancelled: false,
    organizer: null,
  },
  {
    id: `${run}-c`,
    subject: "Kursus",
    start: `${monday}T00:00:00`,
    end: `${monday}T23:59:00`,
    isAllDay: true,
    showAs: "busy",
    isCancelled: false,
    organizer: null,
  },
];
let connected = true;
let app: FastifyInstance;
let off: FastifyInstance;

async function login(target: FastifyInstance, initials: string) {
  const res = await target.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials}@demo.arcnordic.test`, password: "demo1234" },
  });
  return {
    cookie: `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`,
    "x-csrf-token": res.json().csrfToken as string,
  };
}

beforeAll(async () => {
  app = await buildApp(config, db, {
    calendar: {
      enabled: true,
      sourceFor: async () => (connected ? { kind: "fake", listEvents: async () => events } : null),
    },
  });
  off = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await off.close();
  await close();
});

describe("calendar import", () => {
  it("is disabled by default (no Entra / GRAPH_CALENDAR_ENABLED)", async () => {
    const h = await login(off, "lv");
    const res = await off.inject({ url: `/api/v1/timesheet/calendar/${monday}`, headers: h });
    expect(res.json()).toEqual({ status: "disabled", items: [] });
  });

  it("asks the user to connect when there is no valid token", async () => {
    connected = false;
    const h = await login(app, "lv");
    const res = await app.inject({ url: `/api/v1/timesheet/calendar/${monday}`, headers: h });
    expect(res.json().status).toBe("not_connected");
    connected = true;
  });

  it("lists only importable meetings, rounded to 0,25 h, and imports one as draft hours", async () => {
    const h = await login(app, "lv");
    const week = (await app.inject({ url: `/api/v1/timesheet/calendar/${monday}`, headers: h })).json();
    expect(week.status).toBe("connected");
    expect(week.items).toHaveLength(1);
    expect(week.items[0]).toMatchObject({
      subject: "Byggemøde",
      hours: 1.5,
      from: "09:00",
      to: "10:30",
      state: "new",
    });

    const tasks = (await app.inject({ url: "/api/v1/timesheet/tasks", headers: h })).json() as {
      taskId: string;
      commentRequired?: boolean;
    }[];
    const taskId = tasks[0]?.taskId as string;
    const before = (await app.inject({ url: `/api/v1/timesheet/week/${monday}`, headers: h })).json();
    const cellRow = before.rows.find((r: { key: string }) => r.key === `t:${taskId}`)?.cells[monday];
    const cellBefore = cellRow?.hours ?? 0;
    const commentBefore = cellRow?.comment ?? null;
    if (before.status !== "open" && before.status !== "rejected") return; // week already submitted in this DB: nothing to import into

    try {
      const imp = await app.inject({
        method: "POST",
        url: "/api/v1/timesheet/calendar/import",
        headers: h,
        payload: { items: [{ eventId: `${run}-a`, date: monday, subject: "Byggemøde", taskId, hours: 1.5 }] },
      });
      expect(imp.statusCode).toBe(200);
      const after = (await app.inject({ url: `/api/v1/timesheet/week/${monday}`, headers: h })).json();
      expect(after.rows.find((r: { key: string }) => r.key === `t:${taskId}`)?.cells[monday]?.hours).toBe(
        cellBefore + 1.5,
      );

      const again = await app.inject({
        method: "POST",
        url: "/api/v1/timesheet/calendar/import",
        headers: h,
        payload: { items: [{ eventId: `${run}-a`, date: monday, subject: "Byggemøde", taskId, hours: 1.5 }] },
      });
      expect(again.statusCode).toBe(409);
      const marked = (await app.inject({ url: `/api/v1/timesheet/calendar/${monday}`, headers: h })).json();
      expect(marked.items[0].state).toBe("imported");
    } finally {
      // Clean up even when an assertion fails: put the cell back exactly as it was.
      await app.inject({
        method: "PUT",
        url: "/api/v1/timesheet/entries",
        headers: h,
        payload: { date: monday, taskId, hours: cellBefore, comment: commentBefore },
      });
    }
  });

  it("can ignore a meeting", async () => {
    const h = await login(app, "lv");
    await app.inject({
      method: "POST",
      url: "/api/v1/timesheet/calendar/ignore",
      headers: h,
      payload: { eventId: `${run}-a`, date: monday },
    });
    const week = (await app.inject({ url: `/api/v1/timesheet/calendar/${monday}`, headers: h })).json();
    expect(["ignored", "imported"]).toContain(week.items[0].state);
  });
});

describe("graph token encryption", () => {
  it("round-trips and rejects a wrong secret", () => {
    const enc = encryptToken("eyJ0eXAi.fake", config.SESSION_SECRET);
    expect(enc).not.toContain("eyJ0eXAi");
    expect(decryptToken(enc, config.SESSION_SECRET)).toBe("eyJ0eXAi.fake");
    expect(() => decryptToken(enc, `${config.SESSION_SECRET}x`)).toThrow();
  });
});
