/**
 * The end of a case's life (D-041): "Afslut fase" makes the phase's instalment klar at once and is refused while
 * hours are unsubmitted; "Afslut sag" (Admin) is refused while anything is open and sets the case completed when
 * nothing is; sub-consultants' invoices are part of the case's kostpris. Runs in rolled-back transactions.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { caseFinanceDetail, saveBillingPlan } from "./services/case-finance.ts";
import { completionCheck, setPhaseStatus, setProjectStatus } from "./services/case-lifecycle.ts";
import { addProjectMember, addTask, createProject } from "./services/project-setup.ts";
import { addSubInvoice } from "./services/subconsultants.ts";

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
  return { id: m.id as string, tenantId: m.tenantId as string, roles: m.roles as AuthContext["roles"] };
}
const authOf = (u: { id: string; tenantId: string; roles: AuthContext["roles"] }): AuthContext => ({
  userId: u.id,
  tenantId: u.tenantId,
  roles: u.roles,
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

/** A fixed-price case (10.000 kr, two phases) with an active plan; rate 2 is dated far in the future. */
async function fixedCase(tx: Tx, admin: AuthContext, managerId: string) {
  const [customer] = await tx.select().from(schema.customers).limit(1);
  const p = await createProject(tx, admin, {
    name: "Prøvesag – afslutning",
    customerId: customer?.id ?? null,
    managerId,
    contractType: "fixed_price",
    price: 10_000,
    hourlyRate: 1000,
    startDate: "2026-11-02",
    billable: true,
  });
  const a = await addTask(tx, admin, p.id, {
    parentId: null,
    name: "Fase A",
    budgetHours: 5,
    budgetAmount: 5000,
  });
  const b = await addTask(tx, admin, p.id, {
    parentId: null,
    name: "Fase B",
    budgetHours: 5,
    budgetAmount: 5000,
  });
  const [c] = await tx.select().from(schema.contracts).where(eq(schema.contracts.projectId, p.id));
  await saveBillingPlan(tx, admin, c?.id as string, {
    activate: true,
    items: [
      { description: "Rate 1 · Fase A", taskId: a?.id ?? null, percentage: 50, plannedDate: "2030-01-01" },
      { description: "Rate 2 · Fase B", taskId: b?.id ?? null, percentage: 50, plannedDate: "2030-02-01" },
    ],
  });
  return { projectId: p.id, a: a?.id as string, b: b?.id as string };
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("Afslut fase (D-041)", () => {
  it("closing a phase makes its instalment klar at once; reopening reverses it", async () => {
    const kh = await me("kh");
    const al = await me("al");
    await inRollback(kh.tenantId, async (tx) => {
      const c = await fixedCase(tx, authOf(kh), al.id);
      const status = async () =>
        (await caseFinanceDetail(tx, authOf(kh), c.projectId)).plans[0]?.items.map((i) => i.status);
      expect(await status()).toEqual(["planlagt", "afventer"]);
      await setPhaseStatus(tx, authOf(al), c.a, "closed"); // the project manager closes phase A
      expect(await status()).toEqual(["klar", "afventer"]);
      const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, c.a));
      expect(task?.status).toBe("closed");
      await setPhaseStatus(tx, authOf(al), c.a, "open");
      expect(await status()).toEqual(["planlagt", "afventer"]);
    });
  });

  it("is refused while someone has unsubmitted hours on the phase, and for a team member", async () => {
    const kh = await me("kh");
    const al = await me("al");
    const ek = await me("ek");
    await inRollback(kh.tenantId, async (tx) => {
      const c = await fixedCase(tx, authOf(kh), al.id);
      await addProjectMember(tx, authOf(kh), c.projectId, ek.id);
      await tx.insert(schema.timeEntries).values({
        tenantId: kh.tenantId,
        userId: ek.id,
        date: "2026-11-10",
        projectId: c.projectId,
        taskId: c.a,
        hours: 2,
        billable: true,
        status: "draft",
      });
      await expect(setPhaseStatus(tx, authOf(al), c.a, "closed")).rejects.toMatchObject({
        code: "phase_has_open_hours",
      });
      await expect(setPhaseStatus(tx, authOf(ek), c.b, "closed")).rejects.toMatchObject({
        code: "forbidden",
      });
    });
  });
});

describe("Afslut sag (D-041)", () => {
  it("lists what is open, refuses while anything is, and only Admin may complete", async () => {
    const kh = await me("kh");
    const al = await me("al");
    const jf = await me("jf");
    await inRollback(kh.tenantId, async (tx) => {
      const c = await fixedCase(tx, authOf(kh), al.id);
      const check = await completionCheck(tx, authOf(kh), c.projectId);
      expect(check.blockers).toEqual([{ code: "instalments_left", count: 2, amount: 1_000_000 }]);
      await expect(setProjectStatus(tx, authOf(kh), c.projectId, "completed")).rejects.toMatchObject({
        code: "case_not_done",
      });
      await expect(setProjectStatus(tx, authOf(jf), c.projectId, "completed")).rejects.toMatchObject({
        code: "forbidden",
      });
    });
  });

  it("completes a case with nothing left; it can be reopened", async () => {
    const kh = await me("kh");
    const al = await me("al");
    await inRollback(kh.tenantId, async (tx) => {
      const [customer] = await tx.select().from(schema.customers).limit(1);
      const p = await createProject(tx, authOf(kh), {
        name: "Prøvesag – tom",
        customerId: customer?.id ?? null,
        managerId: al.id,
        contractType: "time_material",
        hourlyRate: 1000,
        startDate: "2026-11-02",
        billable: true,
      });
      expect((await completionCheck(tx, authOf(kh), p.id)).blockers).toEqual([]);
      await setProjectStatus(tx, authOf(kh), p.id, "completed");
      const [done] = await tx.select().from(schema.projects).where(eq(schema.projects.id, p.id));
      expect(done?.status).toBe("completed");
      expect(done?.endDate).not.toBeNull();
      await setProjectStatus(tx, authOf(kh), p.id, "active");
      const [again] = await tx.select().from(schema.projects).where(eq(schema.projects.id, p.id));
      expect(again?.status).toBe("active");
    });
  });
});

describe("sub-consultants in the case's kostpris (D-041)", () => {
  it("a registered sub-consultant invoice is added to kostpris and shown on its own", async () => {
    const kh = await me("kh");
    const al = await me("al");
    await inRollback(kh.tenantId, async (tx) => {
      const c = await fixedCase(tx, authOf(kh), al.id);
      const before = await caseFinanceDetail(tx, authOf(kh), c.projectId);
      await addSubInvoice(tx, authOf(kh), c.projectId, {
        supplier: "Statik ApS",
        invoiceDate: "2026-11-15",
        amount: 3_000,
      });
      const after = await caseFinanceDetail(tx, authOf(kh), c.projectId);
      expect(after.kostpris - before.kostpris).toBe(300_000);
      expect(after.underraadgivere).toBe(300_000);
    });
  });
});
