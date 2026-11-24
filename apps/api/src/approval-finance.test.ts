/**
 * Approval mode "finance" (D-040): every submitted week goes straight to Finance, who approves or rejects; line
 * managers and project managers no longer approve hours, and nobody approves their own week. Runs in rolled-back
 * transactions on the seeded database.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { approvalInbox, approvePeriod, canApproveTimesheet, rejectPeriod } from "./services/approval.ts";

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

/** Puts the tenant in finance mode and marks one of the employee's weeks as submitted. */
async function setup(tx: Tx, tenantId: string, userId: string) {
  await tx.update(schema.tenants).set({ approvalMode: "finance" }).where(eq(schema.tenants.id, tenantId));
  const [week] = await tx
    .select()
    .from(schema.timesheetPeriods)
    .where(and(eq(schema.timesheetPeriods.userId, userId), ne(schema.timesheetPeriods.status, "approved")))
    .limit(1);
  const [p] = week
    ? await tx
        .update(schema.timesheetPeriods)
        .set({ status: "submitted" })
        .where(eq(schema.timesheetPeriods.id, week.id))
        .returning()
    : await tx
        .insert(schema.timesheetPeriods)
        .values({ tenantId, userId, weekStart: "2026-11-09", status: "submitted" })
        .returning();
  return p as typeof schema.timesheetPeriods.$inferSelect;
}

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("approval mode 'finance' (D-040)", () => {
  it("the line manager no longer approves; Finance sees the week and approves it", async () => {
    const ek = await me("ek");
    const al = await me("al"); // Emil's line manager and a project manager
    const jf = await me("jf"); // Finance
    await inRollback(ek.tenantId, async (tx) => {
      const week = await setup(tx, ek.tenantId, ek.id);
      expect(await canApproveTimesheet(tx, authOf(al), ek.id)).toBe(false);
      expect((await approvalInbox(tx, authOf(al), week.weekStart)).items).toEqual([]);
      await expect(approvePeriod(tx, authOf(al), week.id)).rejects.toMatchObject({ code: "forbidden" });

      const inbox = await approvalInbox(tx, authOf(jf), week.weekStart);
      expect(inbox.items.find((i) => i.user.id === ek.id)?.status).toBe("submitted");
      const r = await approvePeriod(tx, authOf(jf), week.id);
      expect(r.status).toBe("approved");
      const [after] = await tx
        .select()
        .from(schema.timesheetPeriods)
        .where(eq(schema.timesheetPeriods.id, week.id));
      expect(after?.decidedBy).toBe(jf.id);
    });
  });

  it("Finance can reject with a comment; nobody approves their own week", async () => {
    const ek = await me("ek");
    const jf = await me("jf");
    await inRollback(ek.tenantId, async (tx) => {
      const week = await setup(tx, ek.tenantId, ek.id);
      expect((await rejectPeriod(tx, authOf(jf), week.id, "Mangler kommentar på tirsdag")).status).toBe(
        "rejected",
      );
      const own = await setup(tx, jf.tenantId, jf.id);
      expect(await canApproveTimesheet(tx, authOf(jf), jf.id)).toBe(false);
      await expect(approvePeriod(tx, authOf(jf), own.id)).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  it("the line manager mode is unchanged: the line manager approves, Finance does not", async () => {
    const ek = await me("ek");
    const al = await me("al");
    const jf = await me("jf");
    await inRollback(ek.tenantId, async (tx) => {
      await tx
        .update(schema.tenants)
        .set({ approvalMode: "line_manager" })
        .where(eq(schema.tenants.id, ek.tenantId));
      expect(await canApproveTimesheet(tx, authOf(al), ek.id)).toBe(true);
      expect(await canApproveTimesheet(tx, authOf(jf), ek.id)).toBe(false);
    });
  });
});
