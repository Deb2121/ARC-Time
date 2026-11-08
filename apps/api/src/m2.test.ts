/**
 * M2 money against the seeded dev database. Repeatable: every run books an invoice and then a full credit note
 * that re-opens the hours, so the same entries are invoiceable again next time.
 */
import { bookInvoice, createDb, schema, withTenant } from "@arc-tid/db";
import { startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import { eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 3 });
let app: FastifyInstance;
/** drafts created by these tests; any still unbooked are deleted afterwards so a failure never leaks state */
const createdDrafts: string[] = [];

type Session = { cookie: string; csrf: string; id: string; tenantId: string };
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
  const s = { cookie, csrf: res.json().csrfToken, id: me.id, tenantId: me.tenantId };
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

async function projectId(number: string) {
  const list = (await get("JF", "/api/v1/projects")).json();
  return list.find((p: { number: string }) => p.number === number);
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  for (const id of createdDrafts) {
    const inv = await get("JF", `/api/v1/invoices/${id}`);
    if (inv.statusCode === 200 && inv.json().status !== "booked")
      await send("JF", "DELETE", `/api/v1/invoices/${id}`);
  }
  await app.close();
  await close();
});

describe("permissions", () => {
  it("employees cannot see invoicing; project managers see only their own projects", async () => {
    expect((await get("LV", "/api/v1/invoicing/basis")).statusCode).toBe(403);
    expect((await get("LV", "/api/v1/invoices")).statusCode).toBe(403);
    const pm = (await get("AL", "/api/v1/invoicing/basis")).json();
    expect(pm.every((r: { managerInitials: string }) => r.managerInitials === "AL")).toBe(true);
    expect(
      (await send("AL", "POST", "/api/v1/periods/00000000-0000-0000-0000-000000000000/close", {})).statusCode,
    ).toBe(403);
  });
});

describe("invoice lifecycle: draft → write-down → book → credit (re-open)", () => {
  it("runs the full cycle and keeps numbering gap-free", async () => {
    const p = await projectId("26004");
    const basis = (await get("JF", `/api/v1/invoicing/basis?upTo=${today}`)).json();
    const row = basis.find((b: { projectId: string }) => b.projectId === p.id);
    expect(row.hours).toBeGreaterThan(0);

    const draft = await send("JF", "POST", "/api/v1/invoices/drafts", {
      customerId: row.customerId,
      projectIds: [p.id],
      upTo: today,
      invoiceDate: today,
      grouping: "task",
    });
    expect(draft.statusCode).toBe(200);
    const id = draft.json().id;
    createdDrafts.push(id);

    // Reserved: the same hours are no longer in the basis
    const after = (await get("JF", `/api/v1/invoicing/basis?upTo=${today}`)).json();
    expect(after.find((b: { projectId: string }) => b.projectId === p.id)).toBeUndefined();

    // Hours held by a draft invoice cannot be reopened by the approver
    const held = await withTenant(db, (await as("JF")).tenantId, async (tx) => {
      const rows = await tx.execute<{ period_id: string }>(sql`
        select tp.id as period_id from invoice_line_sources s
        join invoice_lines l on l.id = s.invoice_line_id
        join time_entries e on e.id = s.time_entry_id
        join users u on u.id = e.user_id
        join timesheet_periods tp on tp.user_id = e.user_id and e.date between tp.week_start and tp.week_start + 6
        where l.invoice_id = ${id} and u.initials in ('LV', 'PD') and tp.status = 'approved'
          and tp.week_start >= (select min(month) from accounting_periods where status = 'open') limit 1`);
      return rows[0]?.period_id;
    });
    if (held) {
      const r = await send("AL", "POST", `/api/v1/approvals/${held}/reopen`, { reason: "test" });
      expect(r.json().error).toBe("contains_invoiced_entries");
    }

    // Write-down needs a reason and is spread exactly over the entries
    const inv = (await get("JF", `/api/v1/invoices/${id}`)).json();
    const line = inv.lines.find((l: { kind: string }) => l.kind === "time");
    const lowered = Math.floor(line.amount / 100) - 500; // kr
    expect(
      (await send("JF", "PATCH", `/api/v1/invoice-lines/${line.id}`, { amount: lowered })).json().error,
    ).toBe("write_reason_required");
    expect(
      (
        await send("JF", "PATCH", `/api/v1/invoice-lines/${line.id}`, {
          amount: lowered,
          writeReason: "Aftalt rabat",
        })
      ).statusCode,
    ).toBe(200);
    const sum = await withTenant(db, (await as("JF")).tenantId, async (tx) => {
      const [r] = await tx
        .select({ s: sql<string>`sum(${schema.invoiceLineSources.invoiced})` })
        .from(schema.invoiceLineSources)
        .where(eq(schema.invoiceLineSources.invoiceLineId, line.id));
      return Number(r?.s);
    });
    expect(sum).toBe(lowered * 100);

    // PM can mark ready, only finance books
    expect((await send("AL", "POST", `/api/v1/invoices/${id}/book`)).statusCode).toBe(403);
    expect((await send("AL", "POST", `/api/v1/invoices/${id}/ready`)).statusCode).toBe(200);
    const booked = await send("JF", "POST", `/api/v1/invoices/${id}/book`);
    expect(booked.statusCode).toBe(200);
    const number = booked.json().number;

    // §9: an invoiced entry never appears in a new invoice suggestion
    const again = await send("JF", "POST", "/api/v1/invoices/drafts", {
      customerId: row.customerId,
      projectIds: [p.id],
      upTo: today,
      invoiceDate: today,
      grouping: "task",
    });
    expect(again.json().error).toBe("nothing_to_invoice");

    // Booked invoices are immutable — API and database trigger
    expect(
      (await send("JF", "PATCH", `/api/v1/invoice-lines/${line.id}`, { description: "x" })).json().error,
    ).toBe("invoice_booked");
    expect((await send("JF", "DELETE", `/api/v1/invoices/${id}`)).json().error).toBe("invoice_booked");
    await expect(
      withTenant(db, (await as("JF")).tenantId, (tx) =>
        tx.update(schema.invoices).set({ total: 1 }).where(eq(schema.invoices.id, id)),
      ),
    ).rejects.toSatisfy((e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23514");

    // PDF renders
    const pdf = await get("JF", `/api/v1/invoices/${id}/pdf`);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe("%PDF");

    // Full credit note with re-open → booked with the next number → hours invoiceable again
    const credit = await send("JF", "POST", `/api/v1/invoices/${id}/credit`, { reopenSources: true });
    const creditBooked = await send("JF", "POST", `/api/v1/invoices/${credit.json().id}/book`);
    expect(creditBooked.json().number).toBe(number + 1);
    const reopened = (await get("JF", `/api/v1/invoicing/basis?upTo=${today}`)).json();
    expect(reopened.find((b: { projectId: string }) => b.projectId === p.id)?.hours).toBe(row.hours);
  });

  it("§9: a failed booking rolls back the counter — no gaps, no reuse", async () => {
    const jf = await as("JF");
    const p = await projectId("26004");
    const basis = (await get("JF", `/api/v1/invoicing/basis?upTo=${today}`)).json();
    const row = basis.find((b: { projectId: string }) => b.projectId === p.id);
    const id = (
      await send("JF", "POST", "/api/v1/invoices/drafts", {
        customerId: row.customerId,
        projectIds: [p.id],
        upTo: today,
        invoiceDate: today,
        grouping: "summary",
      })
    ).json().id;
    createdDrafts.push(id);

    const next = await withTenant(db, jf.tenantId, async (tx) => {
      const [s] = await tx.select().from(schema.numberSeries);
      return s?.nextNumber ?? 0;
    });
    // Booking succeeds inside the transaction, then something later fails → everything rolls back
    await expect(
      withTenant(db, jf.tenantId, async (tx) => {
        await bookInvoice(tx, jf.tenantId, jf.id, id);
        throw new Error("simulated failure after numbering");
      }),
    ).rejects.toThrow("simulated failure");
    const booked = await send("JF", "POST", `/api/v1/invoices/${id}/book`);
    expect(booked.json().number).toBe(next);

    // The whole series is contiguous
    const numbers = await withTenant(db, jf.tenantId, async (tx) =>
      (
        await tx
          .select({ n: schema.invoices.number })
          .from(schema.invoices)
          .where(sql`${schema.invoices.number} is not null`)
      )
        .map((r) => r.n ?? 0)
        .sort((a, b) => a - b),
    );
    expect(new Set(numbers).size).toBe(numbers.length);
    expect((numbers.at(-1) ?? 0) - (numbers[0] ?? 0) + 1).toBe(numbers.length);

    // Clean up for the next run
    const credit = await send("JF", "POST", `/api/v1/invoices/${id}/credit`, { reopenSources: true });
    await send("JF", "POST", `/api/v1/invoices/${credit.json().id}/book`);
  });
});

describe("accounting periods", () => {
  it("§9: editing an entry in a closed period is refused", async () => {
    const tasks = (await get("LV", "/api/v1/timesheet/tasks")).json();
    const res = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: "2026-08-12",
      taskId: tasks[0].taskId,
      hours: 1,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().details).toContain("period_locked");
  });

  it("closing checks the checklist and closes months in order", async () => {
    const periods = (await get("JF", "/api/v1/periods")).json();
    const open = periods.filter((p: { status: string }) => p.status === "open");
    const last = open.at(-1);
    if (open.length > 1) {
      expect((await send("JF", "POST", `/api/v1/periods/${last.id}/close`, {})).json().error).toBe(
        "earlier_period_open",
      );
    }
    const first = open[0];
    const res = (
      await send("JF", "POST", `/api/v1/periods/${first.id}/close`, { acknowledge: false })
    ).json();
    if (first.checklist.length) {
      expect(res.closed).toBe(false);
      expect(res.warnings.length).toBeGreaterThan(0);
    }
  });

  it("month-end report shows WIP, fixed-price recognition and retainer deferral", async () => {
    const r = (await get("JF", "/api/v1/periods/2026-09-01/report")).json();
    expect(r.fixedPrice.length).toBeGreaterThan(0);
    expect(r.fixedPrice[0]).toHaveProperty("recognisedThisMonth");
    expect(r.retainers.length).toBe(1);
    // 26001: rate 1 (290.000) + rate 2 (435.000) were invoiced in the previous system before go-live
    const lyng = r.fixedPrice.find((f: { projectNumber: string }) => f.projectNumber === "26001");
    expect(lyng.invoicedToDate).toBe(72_500_000);
    expect(lyng.balance).toBe(lyng.recognisedToDate - 72_500_000);
    expect(typeof r.wipTimeMaterial).toBe("number");
  });
});

describe("rate resolution at approval (brief §4.9)", () => {
  it("framework price list rates are snapshotted for the municipality project", async () => {
    const jf = await as("JF");
    const rates = await withTenant(db, jf.tenantId, async (tx) => {
      const [p] = await tx.select().from(schema.projects).where(eq(schema.projects.number, "26002"));
      const rows = await tx
        .selectDistinct({ r: schema.timeEntries.salesRate })
        .from(schema.timeEntries)
        .where(
          sql`${schema.timeEntries.projectId} = ${p?.id} and ${schema.timeEntries.status} in ('approved','invoiced')`,
        );
      return rows.map((x) => x.r);
    });
    expect(rates.length).toBeGreaterThan(0);
    for (const r of rates) expect([107500, 99500, 87500, 92500]).toContain(r);
  });

  it("price lists are visible to finance with groups and task types", async () => {
    const res = (await get("JF", "/api/v1/price-lists")).json();
    expect(res.lists[0].isStandard).toBe(true);
    expect(res.groups.length).toBeGreaterThan(3);
    expect(res.canEdit).toBe(true);
    expect((await get("LV", "/api/v1/price-lists")).statusCode).toBe(403);
  });
});

describe("payment plan", () => {
  it("lists fixed-price milestones and refuses editing invoiced ones", async () => {
    const p = await projectId("26001");
    const plan = (await get("AL", `/api/v1/projects/${p.id}/payment-plan`)).json();
    expect(plan).toHaveLength(4);
    const invoiced = plan.find((i: { status: string }) => i.status === "invoiced");
    expect((await send("AL", "PATCH", `/api/v1/plan-items/${invoiced.id}`, { amount: 1 })).json().error).toBe(
      "plan_item_invoiced",
    );
    const ids = plan.map((i: { id: string }) => i.id);
    expect(ids.length).toBe(new Set(ids).size);
    void inArray;
  });
});

describe("bookkeeping trail", () => {
  it("clearing an entry that was invoiced and credited back keeps the row (never deleted)", async () => {
    const jf = await as("JF");
    const week = (await get("LV", `/api/v1/timesheet/week/${startOfIsoWeek(today)}`)).json();
    const p = await projectId("26004");
    const tasks = (await get("LV", "/api/v1/timesheet/tasks?q=behovsanalyse")).json();
    const taskId = tasks[0].taskId;
    // register → submit → approve
    expect(
      (await send("LV", "PUT", "/api/v1/timesheet/entries", { date: week.weekStart, taskId, hours: 3 }))
        .statusCode,
    ).toBe(200);
    await send("LV", "POST", `/api/v1/timesheet/week/${week.weekStart}/submit`, {});
    const inbox = (await get("AL", `/api/v1/approvals?weekStart=${week.weekStart}`)).json();
    const periodId = inbox.items.find(
      (i: { user: { initials: string } }) => i.user.initials === "LV",
    ).periodId;
    expect((await send("AL", "POST", `/api/v1/approvals/${periodId}/approve`)).statusCode).toBe(200);
    // invoice → book → credit with re-open → book
    const customerId = (await get("JF", `/api/v1/projects/${p.id}`)).json().customerId;
    const id = (
      await send("JF", "POST", "/api/v1/invoices/drafts", {
        customerId,
        projectIds: [p.id],
        upTo: today,
        invoiceDate: today,
        grouping: "summary",
      })
    ).json().id;
    createdDrafts.push(id);
    await send("JF", "POST", `/api/v1/invoices/${id}/book`);
    const credit = (await send("JF", "POST", `/api/v1/invoices/${id}/credit`, { reopenSources: true })).json()
      .id;
    await send("JF", "POST", `/api/v1/invoices/${credit}/book`);
    // approver reopens the week, employee clears the cell
    expect(
      (await send("AL", "POST", `/api/v1/approvals/${periodId}/reopen`, { reason: "test" })).statusCode,
    ).toBe(200);
    const res = await send("LV", "PUT", "/api/v1/timesheet/entries", {
      date: week.weekStart,
      taskId,
      hours: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cleared: true });
    const kept = await withTenant(db, jf.tenantId, (tx) =>
      tx
        .select({ hours: schema.timeEntries.hours })
        .from(schema.timeEntries)
        .where(
          sql`${schema.timeEntries.userId} = ${(week as { userId: string }).userId} and ${schema.timeEntries.taskId} = ${taskId} and ${schema.timeEntries.date} = ${week.weekStart}`,
        ),
    );
    expect(kept).toEqual([{ hours: 0 }]);
  });
});
