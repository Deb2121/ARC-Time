/**
 * Member prices on a case (D-038): the dropdown's choices, a price from the list or typed in by hand, the estimate
 * before approval, the snapshot at approval, the audit trail and who may do what. Runs in rolled-back transactions.
 */
import { createDb, schema, snapshotRates, type Tx, withTenant } from "@arc-tid/db";
import { kr } from "@arc-tid/domain";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { memberRates, rateChoices, setMemberRate } from "./services/member-rates.ts";
import { addProjectMember, addTask, createProject } from "./services/project-setup.ts";
import { projectDetail } from "./services/projects.ts";

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
  return { cookie, id: m.id as string, tenantId: m.tenantId as string };
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

/** A billable case managed by Anne at 1.000 kr/t with one task, Emil on the team and 2 h he has not submitted. */
async function caseWithHours(tx: Tx, anne: AuthContext, emilId: string, billable = true) {
  const [customer] = await tx.select().from(schema.customers).limit(1);
  const p = await createProject(tx, anne, {
    name: "Prøvesag – timepriser",
    customerId: customer?.id ?? null,
    managerId: anne.userId,
    contractType: "time_material",
    hourlyRate: 1000,
    startDate: "2026-11-02",
    billable,
  });
  const task = await addTask(tx, anne, p.id, {
    parentId: null,
    name: "Skitse",
    budgetHours: 10,
    budgetAmount: 10000,
  });
  await addProjectMember(tx, anne, p.id, emilId);
  const [entry] = await tx
    .insert(schema.timeEntries)
    .values({
      tenantId: anne.tenantId,
      userId: emilId,
      date: "2026-11-10",
      projectId: p.id,
      taskId: task?.id,
      hours: 2,
      billable,
      status: "submitted",
    })
    .returning();
  return { projectId: p.id, entryId: entry?.id as string };
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("member prices on a case (D-038)", () => {
  it("offers the case rate and the standard price list's person lines", async () => {
    const al = await me("al");
    const ek = await me("ek");
    await inRollback(al.tenantId, async (tx) => {
      const { projectId } = await caseWithHours(tx, authOf(al, ["project_manager", "employee"]), ek.id);
      const r = await rateChoices(tx, projectId);
      expect(r.caseRate).toBe(kr(1000));
      const partner = r.choices.find((c) => c.label === "Partner · Standardprisliste 2026");
      expect(partner?.rate).toBe(kr(1350));
      // the catch-all line is offered too; lines for one task type are not (a member price is per person)
      expect(r.choices.some((c) => c.label.startsWith("Alle ·"))).toBe(true);
    });
  });

  it("a price from the list moves Forbrugt before approval, is snapshotted at approval and audited", async () => {
    const al = await me("al");
    const ek = await me("ek");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const { projectId, entryId } = await caseWithHours(tx, anne, ek.id);
      expect((await projectDetail(tx, projectId))?.usedValue).toBe(kr(2000)); // 2 h × case rate 1.000

      await setMemberRate(tx, anne, projectId, ek.id, {
        rate: kr(1350),
        label: "Partner · Standardprisliste 2026",
      });
      expect((await memberRates(tx, projectId)).get(ek.id)).toEqual({
        rate: kr(1350),
        label: "Partner · Standardprisliste 2026",
      });
      expect((await projectDetail(tx, projectId))?.usedValue).toBe(kr(2700)); // 2 h × 1.350

      await snapshotRates(tx, [entryId]);
      const [e] = await tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, entryId));
      expect(e?.salesRate).toBe(kr(1350));

      const [audit] = await tx
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityId, projectId), eq(schema.auditLog.action, "member_rate")));
      expect(audit?.before).toMatchObject({ hourlyRate: null, priceSource: "Sagens timepris" });
      expect(audit?.after).toMatchObject({
        member: "Emil Krogh",
        hourlyRate: kr(1350),
        priceSource: "Partner · Standardprisliste 2026",
      });
    });
  });

  it("a typed-in price is stored as manual; a label that does not match its list price is not trusted", async () => {
    const al = await me("al");
    const ek = await me("ek");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const { projectId } = await caseWithHours(tx, anne, ek.id);
      await setMemberRate(tx, anne, projectId, ek.id, { rate: kr(1100), label: null });
      expect((await memberRates(tx, projectId)).get(ek.id)).toEqual({ rate: kr(1100), label: null });
      await setMemberRate(tx, anne, projectId, ek.id, {
        rate: kr(999),
        label: "Partner · Standardprisliste 2026",
      });
      expect((await memberRates(tx, projectId)).get(ek.id)).toEqual({ rate: kr(999), label: null });
      // back to the case's own hourly rate
      await setMemberRate(tx, anne, projectId, ek.id, { rate: null });
      expect((await memberRates(tx, projectId)).has(ek.id)).toBe(false);
      expect((await projectDetail(tx, projectId))?.usedValue).toBe(kr(2000));
    });
  });

  it("only the manager, Finance or Admin may set it; not on a case that is not invoiced", async () => {
    const al = await me("al");
    const ek = await me("ek");
    await inRollback(al.tenantId, async (tx) => {
      const anne = authOf(al, ["project_manager", "employee"]);
      const { projectId } = await caseWithHours(tx, anne, ek.id);
      await expect(
        setMemberRate(tx, authOf(ek, ["employee"]), projectId, ek.id, { rate: kr(2000) }),
      ).rejects.toMatchObject({ code: "forbidden" });
      const offer = await caseWithHours(tx, anne, ek.id, false);
      await expect(setMemberRate(tx, anne, offer.projectId, ek.id, { rate: kr(1100) })).rejects.toMatchObject(
        { code: "rate_not_billable" },
      );
    });
  });

  it("the case page shows prices to the manager but not to a team member", async () => {
    const al = await me("al");
    const ek = await me("ek");
    // a seeded case Anne manages with Emil on the team
    const [pick] = await withTenant(db, al.tenantId, (tx) =>
      tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
        .where(and(eq(schema.projects.managerId, al.id), eq(schema.projectMembers.userId, ek.id)))
        .limit(1),
    );
    expect(pick).toBeDefined();
    const url = `/api/v1/projects/${pick?.id}`;
    const asPm = (await app.inject({ url, headers: { cookie: al.cookie } })).json();
    expect(asPm.rateChoices).toBeDefined();
    expect(asPm.members[0]).toHaveProperty("price");
    const asEmil = (await app.inject({ url, headers: { cookie: ek.cookie } })).json();
    expect(asEmil.rateChoices).toBeUndefined();
    expect(asEmil.members[0]).not.toHaveProperty("price");
  });
});
