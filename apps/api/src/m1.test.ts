/**
 * M1 core loop against the seeded dev database: register → submit → approve (rate snapshot) → reopen,
 * plus validation and permission checks (brief §9: an employee cannot read another employee's entries
 * unless they are their manager/PM/finance).
 */
import { createDb } from "@arc-tid/db";
import { addDays, startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;

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
  const me = await app.inject({ url: "/api/v1/me", headers: { cookie } });
  const s = { cookie, csrf: res.json().csrfToken, id: me.json().id };
  sessions.set(initials, s);
  return s;
}
const get = async (who: string, url: string) =>
  app.inject({ url, headers: { cookie: (await as(who)).cookie } });
const send = async (
  who: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) => {
  const s = await as(who);
  return app.inject({ method, url, payload, headers: { cookie: s.cookie, "x-csrf-token": s.csrf } });
};

const today = todayCopenhagen();
const week = startOfIsoWeek(today);
const lastWeek = addDays(week, -7);

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("timesheet", () => {
  it("returns the week with norm, rows, summary and flex balance", async () => {
    const res = await get("LV", `/api/v1/timesheet/week/${week}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toHaveLength(7);
    expect(body.summary.norm).toBeGreaterThan(0);
    expect(typeof body.flexBalance).toBe("number");
    expect(body.editable).toBe(true);
  });

  it("lists only tasks on projects the employee is a member of", async () => {
    const res = await get("LV", "/api/v1/timesheet/tasks");
    const numbers = new Set(res.json().map((t: { projectNumber: string }) => t.projectNumber));
    expect(numbers.has("26002")).toBe(true); // member
    expect(numbers.has("26003")).toBe(false); // not a member
  });

  it("refuses future-dated work, more than 24 h, and non-member tasks", async () => {
    const tasks = (await get("LV", "/api/v1/timesheet/tasks")).json();
    const t = tasks.find((x: { projectNumber: string }) => x.projectNumber === "26004");
    const future = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: addDays(today, 3),
      taskId: t.taskId,
      hours: 2,
    });
    expect(future.statusCode).toBe(422);
    expect(future.json().error).toBe("future_date");

    // 1 h on another task first, so 24 h more is always over the limit — whatever the day already holds.
    const other = tasks.find(
      (x: { taskId: string; commentRequired: boolean }) => x.taskId !== t.taskId && !x.commentRequired,
    );
    const day = addDays(lastWeek, 6); // last Sunday: in the past, normally empty
    const before = (await get("LV", `/api/v1/timesheet/week/${lastWeek}`)).json();
    const otherBefore =
      before.rows.find((r: { key: string }) => r.key === `t:${other.taskId}`)?.cells[day]?.hours ?? 0;
    if (before.editable) {
      await send("LV", "PUT", "/api/v1/timesheet/entries", {
        date: day,
        taskId: other.taskId,
        hours: otherBefore + 1,
      });
      const tooMuch = await send("LV", "PUT", "/api/v1/timesheet/entries", {
        date: day,
        taskId: t.taskId,
        hours: 24,
      });
      expect(tooMuch.json().error).toBe("day_over_24");
      await send("LV", "PUT", "/api/v1/timesheet/entries", {
        date: day,
        taskId: other.taskId,
        hours: otherBefore,
      });
    }

    const all = (await get("IS", "/api/v1/timesheet/tasks")).json();
    const foreign = all.find((x: { projectNumber: string }) => x.projectNumber === "26003");
    const res = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: week,
      taskId: foreign.taskId,
      hours: 1,
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires a comment on projects that demand one", async () => {
    const tasks = (await get("LV", "/api/v1/timesheet/tasks")).json();
    const t = tasks.find((x: { projectNumber: string }) => x.projectNumber === "26002"); // commentRequired
    const res = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: week,
      taskId: t.taskId,
      hours: 1,
      comment: "",
    });
    expect(res.json().error).toBe("comment_required");
  });
});

describe("permissions (brief §9)", () => {
  it("an employee cannot read another employee's week", async () => {
    const oliver = await as("OB");
    const res = await get("LV", `/api/v1/timesheet/week/${week}?userId=${oliver.id}`);
    expect(res.statusCode).toBe(403);
  });
  it("a project manager who is not the line manager cannot read the week either", async () => {
    const laura = await as("LV");
    expect((await get("PD", `/api/v1/timesheet/week/${week}?userId=${laura.id}`)).statusCode).toBe(403);
  });
  it("the line manager and finance can", async () => {
    const laura = await as("LV");
    expect((await get("AL", `/api/v1/timesheet/week/${week}?userId=${laura.id}`)).statusCode).toBe(200);
    expect((await get("JF", `/api/v1/timesheet/week/${week}?userId=${laura.id}`)).statusCode).toBe(200);
  });
  it("time-entry report is scoped to visible people", async () => {
    const res = await get("LV", `/api/v1/reports/time-entries?from=${lastWeek}&to=${today}`);
    const initials = new Set(res.json().map((r: { initials: string }) => r.initials));
    expect([...initials]).toEqual(["LV"]);
  });
  it("employees see only their own projects", async () => {
    const numbers = (await get("LV", "/api/v1/projects")).json().map((p: { number: string }) => p.number);
    expect(numbers).toContain("26001");
    expect(numbers).not.toContain("26003");
    expect((await get("KH", "/api/v1/projects")).json()).toHaveLength(10);
  });
});

describe("core loop: register → submit → approve → reopen", () => {
  it("runs the full approval cycle with a rate snapshot", async () => {
    const laura = await as("LV");
    const tasks = (await get("LV", "/api/v1/timesheet/tasks")).json();
    const t = tasks.find((x: { projectNumber: string }) => x.projectNumber === "26004");
    const day = week; // Monday of the current week is never in the future

    const put = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: day,
      taskId: t.taskId,
      hours: 1.25,
      comment: "Workshop",
    });
    expect(put.statusCode).toBe(200);

    const submit = await send("LV", "POST", `/api/v1/timesheet/week/${week}/submit`, { comment: "Uge klar" });
    expect(submit.statusCode).toBe(200);

    // Locked for the employee once submitted
    const locked = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: day,
      taskId: t.taskId,
      hours: 2,
    });
    expect(locked.statusCode).toBe(409);

    // Inbox shows Laura for Anne, not for Peter
    const inbox = (await get("AL", `/api/v1/approvals?weekStart=${week}`)).json();
    const item = inbox.items.find((i: { user: { id: string } }) => i.user.id === laura.id);
    expect(item.status).toBe("submitted");
    expect((await get("PD", `/api/v1/approvals?weekStart=${week}`)).json().items).toHaveLength(0);

    // Reject needs a comment
    const noComment = await send("AL", "POST", `/api/v1/approvals/${item.periodId}/reject`, { comment: " " });
    expect(noComment.statusCode).toBe(400);

    // Not anyone may approve
    expect((await send("PD", "POST", `/api/v1/approvals/${item.periodId}/approve`)).statusCode).toBe(403);

    const approve = await send("AL", "POST", `/api/v1/approvals/${item.periodId}/approve`);
    expect(approve.statusCode).toBe(200);

    // Snapshot: contract rate 1.050 kr on 26004, Laura's cost 450 kr
    const entries = (
      await get("LV", `/api/v1/reports/time-entries?from=${day}&to=${day}&format=json`)
    ).json();
    expect(entries.find((e: { projectNumber: string }) => e.projectNumber === "26004").status).toBe(
      "approved",
    );
    const view = (await get("LV", `/api/v1/timesheet/week/${week}`)).json();
    expect(view.status).toBe("approved");
    expect(view.editable).toBe(false);

    // Approver reopens (audited) → back to open, then employee clears the test entry
    const reopen = await send("AL", "POST", `/api/v1/approvals/${item.periodId}/reopen`, {
      reason: "Test cleanup",
    });
    expect(reopen.statusCode).toBe(200);
    const clear = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: day,
      taskId: t.taskId,
      hours: 0,
    });
    expect(clear.statusCode).toBe(200);
  });

  it("nobody approves their own week", async () => {
    const inbox = (await get("KH", `/api/v1/approvals?weekStart=${lastWeek}`)).json();
    const karen = await as("KH");
    expect(inbox.items.find((i: { user: { id: string } }) => i.user.id === karen.id)).toBeUndefined();
  });
});

describe("projects and reports", () => {
  it("project detail shows WBS, budget vs actual and fixed-price completion", async () => {
    const list = (await get("AL", "/api/v1/projects")).json();
    const p = list.find((x: { number: string }) => x.number === "26001");
    const d = (await get("AL", `/api/v1/projects/${p.id}`)).json();
    expect(d.tasks.some((t: { level: number }) => t.level === 2)).toBe(true);
    expect(d.contracts[0].type).toBe("fixed_price");
    expect(d.contracts[0].completionBp).toBeGreaterThan(0);
    expect(d.canEdit).toBe(true);
  });

  it("enforces WBS max depth of 5 levels", async () => {
    const p = (await get("AL", "/api/v1/projects"))
      .json()
      .find((x: { number: string }) => x.number === "26004");
    let parentId: string | null = null;
    for (let level = 1; level <= 5; level++) {
      const r = await send("AL", "POST", `/api/v1/projects/${p.id}/tasks`, {
        parentId,
        name: `Niveau ${level}`,
      });
      expect(r.statusCode).toBe(200);
      parentId = r.json().id;
    }
    const sixth = await send("AL", "POST", `/api/v1/projects/${p.id}/tasks`, { parentId, name: "Niveau 6" });
    expect(sixth.json().error).toBe("wbs_max_depth");
  });

  it("exports budget vs actual as Danish CSV", async () => {
    const res = await get("KH", "/api/v1/reports/budget-actual?format=csv");
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    expect(res.body).toContain("Projekt;Navn;Kunde");
  });

  it("returns flex and vacation balances", async () => {
    const res = (await get("LV", "/api/v1/me/balances")).json();
    expect(typeof res.flex).toBe("number");
    expect(res.vacation.accrued).toBeGreaterThan(0);
  });
});
