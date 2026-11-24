/**
 * Case finance and debtor list (D-029) against the seeded dev database. Reads go through HTTP (permissions);
 * every write runs inside a transaction that is rolled back, so the demo data is never changed by a test run.
 */
import { bookInvoice, createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { addDays, kr, todayCopenhagen } from "@arc-tid/domain";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import {
  caseFinanceDetail,
  caseOverview,
  invoiceInstalment,
  readyInstalments,
  saveBillingPlan,
  setExtraWork,
} from "./services/case-finance.ts";
import { receivables, registerPayment, registerReminder } from "./services/receivables.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;
const today = todayCopenhagen();

type Who = { cookie: string; id: string; tenantId: string; roles: AuthContext["roles"] };
const cache = new Map<string, Who>();
async function as(initials: string): Promise<Who> {
  const hit = cache.get(initials);
  if (hit) return hit;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials.toLowerCase()}@demo.arcnordic.test`, password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  const m = (await app.inject({ url: "/api/v1/me", headers: { cookie } })).json();
  const who = { cookie, id: m.id as string, tenantId: m.tenantId as string, roles: m.roles };
  cache.set(initials, who);
  return who;
}
const get = async (initials: string, url: string) =>
  app.inject({ url, headers: { cookie: (await as(initials)).cookie } });
const authOf = async (initials: string): Promise<AuthContext> => {
  const w = await as(initials);
  return { userId: w.id, tenantId: w.tenantId, roles: w.roles, csrfToken: "" };
};

class Rollback extends Error {}
/** Runs fn in a tenant transaction and always rolls it back. */
async function inRollback(tenantId: string, fn: (tx: Tx) => Promise<void>) {
  await withTenant(db, tenantId, async (tx) => {
    await fn(tx);
    throw new Rollback();
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

/** A fresh 600.000 kr fixed-fee contract on an existing customer case (inside the rollback). */
async function fixedFeeContract(tx: Tx, tenantId: string, projectNumber: string) {
  const [p] = await tx.select().from(schema.projects).where(eq(schema.projects.number, projectNumber));
  if (!p) throw new Error(`no project ${projectNumber}`);
  const [c] = await tx
    .insert(schema.contracts)
    .values({ tenantId, projectId: p.id, name: "Test fast honorar", type: "fixed_price", price: kr(600_000) })
    .returning();
  if (!c) throw new Error("contract");
  return { project: p, contract: c };
}

beforeAll(async () => {
  app = await buildApp(config, db, { accounting: null });
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("access", () => {
  it("employees and plain admin rights do not see the module; finance and management see all cases", async () => {
    expect((await get("LV", "/api/v1/case-finance/cases")).statusCode).toBe(403);
    expect((await get("LV", "/api/v1/receivables")).statusCode).toBe(403);
    const fin = (await get("JF", "/api/v1/case-finance/cases")).json();
    const mgmt = (await get("KH", "/api/v1/case-finance/cases")).json();
    expect(fin.rows.length).toBeGreaterThanOrEqual(4);
    expect(mgmt.rows.length).toBe(fin.rows.length);
    expect(new Set(fin.rows.map((r: { feeType: string }) => r.feeType))).toEqual(
      new Set(["fast_honorar", "medgaaet_tid"]),
    );
  });

  it("AC: a project manager cannot see cases or invoices where they are not the PM", async () => {
    const al = await as("AL");
    const mine = (await get("AL", "/api/v1/case-finance/cases")).json();
    expect(mine.rows.every((r: { managerId: string }) => r.managerId === al.id)).toBe(true);
    const all = (await get("JF", "/api/v1/case-finance/cases")).json();
    const other = all.rows.find((r: { managerId: string }) => r.managerId !== al.id);
    expect((await get("AL", `/api/v1/case-finance/cases/${other.id}`)).statusCode).toBe(404);
    const debtors = (await get("AL", "/api/v1/receivables?view=all")).json();
    expect(debtors.rows.every((r: { managerId: string }) => r.managerId === al.id)).toBe(true);
    expect(debtors.canManage).toBe(false);
  });

  it("Finance can read the whole audit log and import people (D-029) but not GDPR or settings", async () => {
    const me = (await get("JF", "/api/v1/me")).json();
    expect(me.capabilities).toEqual(
      expect.arrayContaining(["audit.read_all", "people.import", "receivables.manage"]),
    );
    expect(me.capabilities).not.toContain("gdpr.manage");
    expect(me.capabilities).not.toContain("settings.manage");
  });

  it("exports the case overview and the debtor list as CSV for Excel, with a totals row", async () => {
    const csv = await get("JF", "/api/v1/case-finance/cases?format=csv");
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toMatch(/^﻿Sagsnr\.;Sag;Kunde/);
    expect(csv.body).toMatch(/\r\nI alt;/);
    expect((await get("JF", "/api/v1/receivables?format=csv")).body).toMatch(/^﻿Fakturanr\./);
  });

  it("exports the case overview and the debtor list as Excel workbooks (D-033)", async () => {
    for (const [url, name] of [
      ["/api/v1/case-finance/cases?format=xlsx", "ARCtime_sagsoversigt_"],
      ["/api/v1/receivables?format=xlsx", "ARCtime_debitorliste_"],
    ] as const) {
      const res = await get("JF", url);
      expect(res.headers["content-type"]).toContain("spreadsheetml");
      expect(res.headers["content-disposition"]).toContain(name);
      expect(res.rawPayload.subarray(0, 2).toString()).toBe("PK");
    }
  });
});

describe("demo data", () => {
  it("has a ready instalment, an overdue invoice and a partly paid invoice", async () => {
    const ready = (await get("JF", "/api/v1/case-finance/ready-instalments")).json();
    expect(ready.length).toBeGreaterThan(0);
    const d = (await get("JF", "/api/v1/receivables")).json();
    expect(d.rows.some((r: { status: string }) => r.status === "forfalden")).toBe(true);
    expect(d.rows.some((r: { status: string }) => r.status === "delvist_betalt")).toBe(true);
    expect(d.ageing.total).toBe(
      d.rows.reduce((a: number, r: { outstanding: number }) => a + r.outstanding, 0),
    );
  });
});

describe("billing plan", () => {
  it("AC: 20/30/25/25 % of 600.000 kr can be activated, 20/30/25 % is rejected", async () => {
    const jf = await authOf("JF");
    await inRollback(jf.tenantId, async (tx) => {
      const { contract } = await fixedFeeContract(tx, jf.tenantId, "26003");
      const item = (pct: number, n: number) => ({
        description: `Rate ${n}`,
        percentage: pct,
        plannedDate: addDays(today, 30 * n),
      });
      await expect(
        saveBillingPlan(tx, jf, contract.id, {
          activate: true,
          items: [item(20, 1), item(30, 2), item(25, 3)],
        }),
      ).rejects.toMatchObject({ statusCode: 422, code: "plan_not_100_percent" });
      // A draft may be saved incomplete.
      const draft = await saveBillingPlan(tx, jf, contract.id, {
        activate: false,
        items: [item(20, 1), item(30, 2)],
      });
      expect(draft).toMatchObject({ planActive: false, validation: { ok: false, totalBp: 5000 } });
      const ok = await saveBillingPlan(tx, jf, contract.id, {
        activate: true,
        items: [item(20, 1), item(30, 2), item(25, 3), item(25, 4)],
      });
      expect(ok).toMatchObject({ planActive: true, validation: { ok: true, total: kr(600_000) } });
      const rows = await tx
        .select()
        .from(schema.paymentPlanItems)
        .where(eq(schema.paymentPlanItems.contractId, contract.id));
      expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([
        kr(120_000),
        kr(150_000),
        kr(150_000),
        kr(180_000),
      ]);
    });
  });

  it("'Fakturér rate' makes a one-line draft; booking it sets the rate faktureret and the next one klar", async () => {
    const jf = await authOf("JF");
    await inRollback(jf.tenantId, async (tx) => {
      const { project, contract } = await fixedFeeContract(tx, jf.tenantId, "26003");
      await saveBillingPlan(tx, jf, contract.id, {
        activate: true,
        items: [
          { description: "Rate 1 · Dispositionsforslag", percentage: 50, plannedDate: addDays(today, -10) },
          { description: "Rate 2 · Projektforslag", percentage: 50, plannedDate: addDays(today, -1) },
        ],
      });
      const [r1, r2] = await tx
        .select()
        .from(schema.paymentPlanItems)
        .where(eq(schema.paymentPlanItems.contractId, contract.id))
        .orderBy(schema.paymentPlanItems.sequence);
      if (!r1 || !r2) throw new Error("plan");
      // Rate 2's date has passed, but it waits for rate 1.
      await expect(invoiceInstalment(tx, jf, r2.id)).rejects.toMatchObject({ code: "instalment_not_ready" });
      expect((await readyInstalments(tx, jf)).map((r) => r.id)).toContain(r1.id);

      const { invoiceId } = await invoiceInstalment(tx, jf, r1.id);
      const lines = await tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, invoiceId));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ kind: "milestone", amount: kr(300_000), paymentPlanItemId: r1.id });
      await expect(invoiceInstalment(tx, jf, r1.id)).rejects.toMatchObject({ code: "plan_item_on_draft" });

      await bookInvoice(tx, jf.tenantId, jf.userId, invoiceId);
      const detail = await caseFinanceDetail(tx, jf, project.id);
      const plan = detail.plans.find((p) => p.contractId === contract.id);
      expect(plan?.items.map((i) => i.status)).toEqual(["faktureret", "klar"]);
    });
  });

  it("AC: an ekstraarbejde phase moves to the case's time & material contract (billed as medgået tid)", async () => {
    const jf = await authOf("JF");
    await inRollback(jf.tenantId, async (tx) => {
      const [p] = await tx.select().from(schema.projects).where(eq(schema.projects.number, "26003"));
      const [task] = await tx
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, p?.id ?? ""), eq(schema.tasks.level, 1)))
        .limit(1);
      if (!task) throw new Error("task");
      // Release invoiced hours on the phase inside the rollback so the flag may be set.
      await tx
        .update(schema.timeEntries)
        .set({ invoiceLineId: null })
        .where(eq(schema.timeEntries.taskId, task.id));
      const res = await setExtraWork(tx, jf, task.id, true);
      const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.id, res.contractId));
      expect(c?.type).toBe("time_material");
      const [after] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, task.id));
      expect(after).toMatchObject({ extraWork: true, contractId: c?.id });
    });
  });
});

describe("debtor list", () => {
  it("AC: a partial payment gives Delvist betalt and reduces the outstanding amount; reminders in order", async () => {
    const jf = await authOf("JF");
    await inRollback(jf.tenantId, async (tx) => {
      const list = await receivables(tx, jf, { view: "unpaid" });
      const target = list.rows.find((r) => r.paid === 0 && r.outstanding > kr(1_000));
      if (!target) throw new Error("no unpaid invoice in the demo data");
      const after = await registerPayment(tx, jf, target.id, { full: false, amount: 500, paidOn: today });
      expect(after).toMatchObject({ status: "delvist_betalt", outstanding: target.outstanding - kr(500) });
      await expect(
        registerPayment(tx, jf, target.id, { full: false, amount: target.outstanding, paidOn: today }),
      ).rejects.toMatchObject({ code: "payment_exceeds_outstanding" });
      const paid = await registerPayment(tx, jf, target.id, { full: true, paidOn: today });
      expect(paid).toMatchObject({ status: "betalt", outstanding: 0 });

      const overdue = list.rows.find(
        (r) => r.id !== target.id && r.daysOverdue > 0 && r.reminders.length === 0,
      );
      if (overdue) {
        await expect(registerReminder(tx, jf, overdue.id, { level: 2, sentOn: today })).rejects.toMatchObject(
          {
            code: "reminder_out_of_order",
          },
        );
        expect((await registerReminder(tx, jf, overdue.id, { level: 1, sentOn: today })).reminders).toEqual([
          1,
        ]);
      }
    });
  });

  it("a project manager may not register payments", async () => {
    const al = await authOf("AL");
    await inRollback(al.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.status, "booked"), ne(schema.invoices.type, "credit")))
        .limit(1);
      await expect(
        registerPayment(tx, al, inv?.id ?? "", { full: true, paidOn: today }),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  it("the overview cards are consistent with the rows", async () => {
    const jf = await authOf("JF");
    await inRollback(jf.tenantId, async (tx) => {
      const o = await caseOverview(tx, jf);
      expect(o.cards.instalmentsReady).toBe(o.rows.reduce((a, r) => a + r.readyInstalments, 0));
      const fixed = await caseOverview(tx, jf, { feeType: "fast_honorar" });
      expect(fixed.rows.every((r) => r.feeType === "fast_honorar")).toBe(true);
    });
  });
});
