/**
 * Approval modes (docs/spec/approval.md, D-022): project manager step before the line manager (incl. AC3 — after a
 * PM reject and resubmission only the rejected project returns to that PM) and "none" (auto-approve).
 * Uses the current week of EK (line manager AL; projects 26001 PM AL, 26002 PM PD, 26900 PM KH) and FH, and puts
 * everything back afterwards (reopen + mode line_manager).
 */
import { createDb } from "@arc-tid/db";
import { addDays, startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
const monday = startOfIsoWeek(todayCopenhagen());
let app: FastifyInstance;

type Headers = { cookie: string; "x-csrf-token": string };
async function login(initials: string): Promise<Headers> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials}@demo.arcnordic.test`, password: "demo1234" },
  });
  return {
    cookie: `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`,
    "x-csrf-token": res.json().csrfToken,
  };
}
const get = async (h: Headers, url: string) =>
  (await app.inject({ url: `/api/v1${url}`, headers: h })).json();
const post = (h: Headers, url: string, payload: object = {}) =>
  app.inject({ method: "POST", url: `/api/v1${url}`, headers: h, payload });
const setMode = async (mode: string) =>
  app.inject({
    method: "PATCH",
    url: "/api/v1/admin/approval-mode",
    headers: await login("kh"),
    payload: { mode },
  });

interface PmItem {
  userId: string;
  weekStart: string;
  projectId: string;
  projectNumber: string;
  entries: unknown[];
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await setMode("line_manager");
  await app.close();
  await close();
});

describe("approval mode pm_then_line_manager", () => {
  it("only Admin may change the approval mode", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/approval-mode",
      headers: await login("al"),
      payload: { mode: "none" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("project managers decide first; a rejected project alone returns to its PM after resubmission", async () => {
    expect((await setMode("pm_then_line_manager")).statusCode).toBe(200);
    const ek = await login("ek");
    const al = await login("al");
    const pd = await login("pd");
    // The latest open, editable week in which Emil has hours (seed data ages, so do not assume "this week").
    let pmWeek = "";
    let projectCount = 0;
    for (let w = 0; w < 8 && !pmWeek; w++) {
      const candidate = addDays(monday, -7 * w);
      const v = await get(ek, `/timesheet/week/${candidate}`);
      const projects = new Set(
        v.rows
          .filter((r: { kind: string }) => r.kind === "task")
          .map((r: { ref: { projectNumber: string } }) => r.ref.projectNumber),
      );
      if (v.status === "open" && v.editable && projects.has("26001") && projects.has("26002"))
        [pmWeek, projectCount] = [candidate, projects.size];
    }
    if (!pmWeek) return; // no suitable week in this database
    const ekId = (await get(ek, "/me")).id as string;
    try {
      expect((await post(ek, `/timesheet/week/${pmWeek}/submit`, {})).statusCode).toBe(200);

      // Line manager sees one open PM step per project (26001 AL, 26002 PD, 26900 KH — none managed by Emil).
      const inbox = await get(al, `/approvals?weekStart=${pmWeek}`);
      expect(inbox.items.find((i: { user: { id: string } }) => i.user.id === ekId).pmPending).toBe(
        projectCount,
      );

      // AL approves 26001 as its project manager → week partially approved.
      const alPm = (await get(al, "/approvals/projects")).items as PmItem[];
      const p26001 = alPm.find(
        (i) => i.userId === ekId && i.weekStart === pmWeek && i.projectNumber === "26001",
      );
      expect(p26001).toBeTruthy();
      const ok = await post(al, "/approvals/projects/decide", {
        userId: ekId,
        weekStart: pmWeek,
        projectId: p26001?.projectId,
        decision: "approve",
      });
      expect(ok.json().status).toBe("partially_approved");

      // The employee can no longer withdraw a week that a PM has approved.
      expect((await post(ek, `/timesheet/week/${pmWeek}/reopen`)).statusCode).toBe(409);

      // PD rejects 26002 with a comment.
      const p26002 = ((await get(pd, "/approvals/projects")).items as PmItem[]).find(
        (i) => i.userId === ekId && i.weekStart === pmWeek,
      );
      expect(p26002?.projectNumber).toBe("26002");
      expect(
        (
          await post(pd, "/approvals/projects/decide", {
            userId: ekId,
            weekStart: pmWeek,
            projectId: p26002?.projectId,
            decision: "reject",
          })
        ).statusCode,
      ).toBe(400);
      const rej = await post(pd, "/approvals/projects/decide", {
        userId: ekId,
        weekStart: pmWeek,
        projectId: p26002?.projectId,
        decision: "reject",
        comment: "Forkert opgave",
      });
      expect(rej.json().status).toBe("rejected");
      const after = await get(ek, `/timesheet/week/${pmWeek}`);
      expect(after.status).toBe("rejected");
      expect(after.events.some((e: { comment: string | null }) => e.comment?.startsWith("26002"))).toBe(true);

      // EK fixes one 26002 cell and resubmits.
      const row = after.rows.find(
        (r: { kind: string; ref: { projectNumber: string } }) =>
          r.kind === "task" && r.ref.projectNumber === "26002",
      );
      const [date, cell] =
        Object.entries(row.cells as Record<string, { hours: number; comment: string | null }>)[0] ?? [];
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/timesheet/entries",
            headers: ek,
            payload: { date, taskId: row.ref.taskId, hours: cell?.hours, comment: cell?.comment },
          })
        ).statusCode,
      ).toBe(200);
      expect((await post(ek, `/timesheet/week/${pmWeek}/submit`, {})).statusCode).toBe(200);

      // AC3: 26002 is back with PD; 26001 stays approved and is not back with AL.
      expect(
        ((await get(pd, "/approvals/projects")).items as PmItem[]).some(
          (i) => i.userId === ekId && i.projectNumber === "26002",
        ),
      ).toBe(true);
      expect(
        ((await get(al, "/approvals/projects")).items as PmItem[]).some(
          (i) => i.userId === ekId && i.weekStart === pmWeek,
        ),
      ).toBe(false);

      // PD approves; the line manager approves the week (26900 still open → approved on behalf, audited).
      await post(pd, "/approvals/projects/decide", {
        userId: ekId,
        weekStart: pmWeek,
        projectId: p26002?.projectId,
        decision: "approve",
      });
      const lineInbox = await get(al, `/approvals?weekStart=${pmWeek}`);
      const item = lineInbox.items.find((i: { user: { id: string } }) => i.user.id === ekId);
      expect(item.pmPending).toBe(projectCount - 2);
      expect((await post(al, `/approvals/${item.periodId}/approve`)).json().status).toBe("approved");
    } finally {
      const item = (await get(al, `/approvals?weekStart=${pmWeek}`)).items.find(
        (i: { user: { id: string } }) => i.user.id === ekId,
      );
      if (item?.status === "approved")
        await post(al, `/approvals/${item.periodId}/reopen`, { reason: "Testoprydning" });
      else if (item?.status === "submitted") await post(ek, `/timesheet/week/${pmWeek}/reopen`);
      else if (item?.status === "partially_approved" || item?.status === "rejected") {
        await post(al, `/approvals/${item.periodId}/approve`).catch(() => undefined);
        await post(al, `/approvals/${item.periodId}/reopen`, { reason: "Testoprydning" });
      }
      expect((await get(ek, `/timesheet/week/${pmWeek}`)).status).toBe("open");
    }
  });
});

describe("approval mode none", () => {
  it("approves a submitted week at once, with an audit trail", async () => {
    expect((await setMode("none")).statusCode).toBe(200);
    const fh = await login("fh");
    if ((await get(fh, `/timesheet/week/${monday}`)).status !== "open") return;
    try {
      const res = await post(fh, `/timesheet/week/${monday}/submit`, {});
      expect(res.json().status).toBe("approved");
      expect((await get(fh, `/timesheet/week/${monday}`)).status).toBe("approved");
    } finally {
      const sk = await login("sk");
      const fhId = (await get(fh, "/me")).id;
      const item = (await get(sk, `/approvals?weekStart=${monday}`)).items.find(
        (i: { user: { id: string } }) => i.user.id === fhId,
      );
      if (item?.status === "approved")
        await post(sk, `/approvals/${item.periodId}/reopen`, { reason: "Testoprydning" });
      await setMode("line_manager");
    }
  });
});
