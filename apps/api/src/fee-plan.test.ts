/**
 * Rate plan generator and sub-consultants (D-039) against the seeded database: save, generate, use as draft (never
 * over an active plan), Excel export, sub-consultant invoices with budget vs registered, and re-invoicing with
 * markup — reserved on a draft, released when the draft is deleted. Runs in rolled-back transactions.
 */
import { createDb, createDraftFromSuggestion, deleteDraft, schema, type Tx, withTenant } from "@arc-tid/db";
import { kr, todayCopenhagen } from "@arc-tid/domain";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { saveBillingPlan } from "./services/case-finance.ts";
import { applyFeePlan, feePlan, feePlanExport, saveFeePlan } from "./services/fee-plan.ts";
import { addProjectMember, addTask, createProject } from "./services/project-setup.ts";
import {
  addSubInvoice,
  deleteSubInvoice,
  subconsultantOverview,
  updateSubInvoice,
} from "./services/subconsultants.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;

async function me(initials: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials}@demo.arcnordic.test`, password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  const m = (await app.inject({ url: "/api/v1/me", headers: { cookie } })).json();
  return { id: m.id as string, tenantId: m.tenantId as string };
}
const authOf = (u: { id: string; tenantId: string }, roles: AuthContext["roles"]): AuthContext => ({
  userId: u.id,
  tenantId: u.tenantId,
  roles,
  csrfToken: "",
});

class Rollback extends Error {}
async function inRollback(tenantId: string, fn: (tx: Tx) => Promise<void>) {
  await withTenant(db, tenantId, async (tx) => {
    await fn(tx);
    throw new Rollback();
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

/** A fixed-price case of 100.000 kr with two phases (60.000 / 40.000), managed by Anne. */
async function fixedCase(tx: Tx, anne: AuthContext) {
  const [customer] = await tx.select().from(schema.customers).limit(1);
  const p = await createProject(tx, anne, {
    name: "Prøvesag – rateplan",
    customerId: customer?.id ?? null,
    managerId: anne.userId,
    contractType: "fixed_price",
    price: 100_000,
    hourlyRate: 1000,
    startDate: "2026-11-02",
    billable: true,
  });
  const a = await addTask(tx, anne, p.id, {
    parentId: null,
    name: "Projektforslag",
    budgetHours: 60,
    budgetAmount: 60_000,
  });
  const b = await addTask(tx, anne, p.id, {
    parentId: null,
    name: "Udførelse",
    budgetHours: 40,
    budgetAmount: 40_000,
  });
  const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.projectId, p.id));
  return { projectId: p.id, contractId: c?.id as string, a: a?.id as string, b: b?.id as string };
}

/** Phases 60.000 + 30.000 with a 10.000 fee part over both; sub-consultant "Statik ApS" 15.000 by share. */
const input = (a: string, b: string) => ({
  phases: [
    { key: a, name: "Projektforslag", baseFee: kr(60_000), taskId: a, start: "2026-11", weights: [1, 1, 1] },
    { key: b, name: "Udførelse", baseFee: kr(30_000), taskId: b, start: "2027-01", weights: [2, 1] },
  ],
  pools: [{ name: "Projekteringsledelse", amount: kr(10_000), phaseKeys: [a, b] }],
  subs: [{ name: "Statik ApS", mode: "share" as const, total: kr(15_000) }],
});

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("rate plan generator (D-039)", () => {
  it("suggests one phase per task, saves, and writes the plan as a draft to the øre", async () => {
    const al = await me("al");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const c = await fixedCase(tx, anne);
      const first = await feePlan(tx, anne, c.contractId);
      expect(first.saved).toBe(false);
      expect(first.input.phases.map((p) => p.baseFee)).toEqual([kr(60_000), kr(40_000)]);

      const g = await saveFeePlan(tx, anne, c.contractId, input(c.a, c.b));
      expect(g.result.problems).toEqual([]);
      expect(g.result.total).toBe(kr(100_000));
      expect(g.priceMismatch).toBe(false);
      // fee part 10.000 split 60:30 → 6.666,67 + 3.333,33; phase 1 = 66.666,67 in thirds
      expect(g.result.phases[0]?.total).toBe(kr(66_666.67));
      expect(g.result.instalments.map((i) => i.date)).toEqual([
        "2026-11-01",
        "2026-12-01",
        "2027-01-01",
        "2027-01-01",
        "2027-02-01",
      ]);
      expect(g.canApply).toBe(true);

      expect(await applyFeePlan(tx, anne, c.contractId)).toEqual({ instalments: 5, total: kr(100_000) });
      const items = await tx
        .select()
        .from(schema.paymentPlanItems)
        .where(eq(schema.paymentPlanItems.contractId, c.contractId));
      expect(items).toHaveLength(5);
      expect(items.reduce((s, i) => s + i.amount, 0)).toBe(kr(100_000));
      expect(items.find((i) => i.sequence === 1)?.amount).toBe(g.result.instalments[0]?.amount);
      expect(items.find((i) => i.sequence === 4)?.taskId).toBe(c.b);
      const [contract] = await tx
        .select()
        .from(schema.contracts)
        .where(eq(schema.contracts.id, c.contractId));
      expect(contract?.planActive).toBe(false); // only a draft
    });
  });

  it("never replaces an active plan; a team member may not save", async () => {
    const al = await me("al");
    const ek = await me("ek");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const c = await fixedCase(tx, anne);
      await saveBillingPlan(tx, anne, c.contractId, {
        activate: true,
        items: [{ description: "Hele honoraret", amount: 100_000, plannedDate: "2026-12-01" }],
      });
      await saveFeePlan(tx, anne, c.contractId, input(c.a, c.b));
      expect((await feePlan(tx, anne, c.contractId)).blockedBy).toBe("plan_active");
      await expect(applyFeePlan(tx, anne, c.contractId)).rejects.toMatchObject({ code: "plan_active" });
      const items = await tx
        .select()
        .from(schema.paymentPlanItems)
        .where(eq(schema.paymentPlanItems.contractId, c.contractId));
      expect(items.map((i) => i.description)).toEqual(["Hele honoraret"]); // untouched
      await addProjectMember(tx, anne, c.projectId, ek.id);
      await expect(
        saveFeePlan(tx, authOf(ek, ["employee"]), c.contractId, input(c.a, c.b)),
      ).rejects.toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) });
    });
  });

  it("exports the plan with phase rows, instalments, the sub-consultant's column and a control row", async () => {
    const al = await me("al");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const c = await fixedCase(tx, anne);
      await saveFeePlan(tx, anne, c.contractId, input(c.a, c.b));
      const t = await feePlanExport(tx, anne, c.contractId);
      expect(t.columns.map((x) => x.header)).toContain("Statik ApS (kr)");
      const last = t.rows.at(-1);
      expect(last?.label).toBe("KONTROL");
      expect(last?.amount).toBe(100_000);
      expect(last?.subs[0]).toBe(15_000);
      expect(t.rows.filter((r) => r.label.trim().startsWith("Rate"))).toHaveLength(5);
    });
  });
});

describe("sub-consultants' invoices (D-039)", () => {
  it("registered invoices are compared with the sub-consultant's fee in the rate plan", async () => {
    const al = await me("al");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const c = await fixedCase(tx, anne);
      await saveFeePlan(tx, anne, c.contractId, input(c.a, c.b));
      await addSubInvoice(tx, anne, c.projectId, {
        supplier: "Statik ApS",
        invoiceNumber: "2211",
        invoiceDate: "2026-11-15",
        amount: 4_000,
        taskId: c.a,
      });
      const o = await subconsultantOverview(tx, anne, c.projectId);
      expect(o.suppliers).toEqual([
        { name: "Statik ApS", budget: kr(15_000), registered: kr(4_000), remaining: kr(11_000) },
      ]);
      expect(o.invoices[0]?.phase).toBe("Projektforslag");
      expect(o.invoices[0]?.rebill).toBe(false);
    });
  });

  it("re-invoiced with 10 % markup on the customer's draft; locked while on it, released when it is deleted", async () => {
    const al = await me("al");
    const kh = await me("kh");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const [customer] = await tx.select().from(schema.customers).limit(1);
      const p = await createProject(tx, anne, {
        name: "Prøvesag – underrådgiver",
        customerId: customer?.id ?? null,
        managerId: anne.userId,
        contractType: "time_material",
        hourlyRate: 1000,
        startDate: "2026-11-02",
        billable: true,
      });
      const sub = await addSubInvoice(tx, anne, p.id, {
        supplier: "Geoteknik A/S",
        invoiceNumber: "77",
        invoiceDate: "2026-11-10",
        amount: 2_000,
        rebill: true,
        markupPct: 10,
      });
      const draftId = await createDraftFromSuggestion(tx, {
        tenantId: kh.tenantId,
        userId: kh.id,
        customerId: customer?.id as string,
        projectIds: [p.id],
        upTo: todayCopenhagen(),
        invoiceDate: todayCopenhagen(),
        grouping: "task",
      });
      expect(draftId).not.toBeNull();
      const lines = await tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, draftId as string));
      const line = lines.find((l) => l.description.startsWith("Underrådgiver Geoteknik A/S"));
      expect(line?.amount).toBe(kr(2_200));
      expect(line?.description).toBe("Underrådgiver Geoteknik A/S (faktura 77)");

      await expect(
        updateSubInvoice(tx, anne, sub?.id as string, {
          supplier: "Geoteknik A/S",
          invoiceDate: "2026-11-10",
          amount: 1,
        }),
      ).rejects.toMatchObject({ code: "subinvoice_on_invoice" });

      await deleteDraft(tx, kh.tenantId, kh.id, draftId as string);
      const [after] = await tx
        .select()
        .from(schema.subconsultantInvoices)
        .where(eq(schema.subconsultantInvoices.id, sub?.id as string));
      expect(after?.invoiceLineId).toBeNull();
      await deleteSubInvoice(tx, anne, sub?.id as string);
    });
  });

  it("cannot be re-invoiced on a case that is not invoiced to the customer", async () => {
    const al = await me("al");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const [customer] = await tx.select().from(schema.customers).limit(1);
      const p = await createProject(tx, anne, {
        name: "Prøvesag – tilbud",
        customerId: customer?.id ?? null,
        managerId: anne.userId,
        contractType: "time_material",
        hourlyRate: 1000,
        startDate: "2026-11-02",
        billable: false,
      });
      await expect(
        addSubInvoice(tx, anne, p.id, {
          supplier: "X",
          invoiceDate: "2026-11-10",
          amount: 100,
          rebill: true,
        }),
      ).rejects.toMatchObject({ code: "rebill_not_billable" });
    });
  });
});
