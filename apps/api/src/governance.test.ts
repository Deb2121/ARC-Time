/**
 * Review fixes (D-025/D-026): segregation of duties (Admin cannot book, credit, close or export payroll), "create if
 * right" for projects, sickness privacy, the audit-log reader and GDPR export/erasure. Writes run in a rolled-back
 * transaction, so the demo database is unchanged.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { erasePerson, exportPersonalData, retentionSweep } from "./services/gdpr.ts";
import { weekView } from "./services/timesheet.ts";

const config = loadConfig({ NODE_ENV: "test", DEV_LOGIN_ENABLED: "true", AUTH_RATE_LIMIT: "1000" });
const { db, close } = createDb(config.DATABASE_URL, { max: 2 });
let app: FastifyInstance;

async function login(initials: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: `${initials}@demo.arcnordic.test`, password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  const headers = { cookie, "x-csrf-token": res.json().csrfToken as string };
  const me = (await app.inject({ url: "/api/v1/me", headers })).json();
  return { headers, me };
}
const get = (h: object, url: string) =>
  app.inject({ url: `/api/v1${url}`, headers: h as Record<string, string> });
const post = (h: object, url: string, payload: object = {}) =>
  app.inject({ method: "POST", url: `/api/v1${url}`, headers: h as Record<string, string>, payload });

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

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("segregation of duties (D-025)", () => {
  it("Admin cannot book, credit, close periods or export payroll; Finance can see those actions", async () => {
    const kh = await login("kh"); // Admin + Management + line manager
    const jf = await login("jf"); // Finance
    const [period] = (await get(jf.headers, "/periods")).json();
    const list = (await get(jf.headers, "/invoices?status=booked")).json();
    const invoice = (Array.isArray(list) ? list : list.items)?.[0];
    expect(invoice?.id).toBeTruthy();
    expect((await post(kh.headers, `/periods/${period.id}/close`, {})).statusCode).toBe(403);
    expect((await post(kh.headers, `/periods/${period.id}/reopen`, { reason: "x" })).statusCode).toBe(403);
    expect((await post(kh.headers, `/invoices/${invoice.id}/book`)).statusCode).toBe(403);
    expect((await post(kh.headers, `/invoices/${invoice.id}/credit`, {})).statusCode).toBe(403);
    expect((await post(kh.headers, "/payroll/periods/2026-10-01/export")).statusCode).toBe(403);
    expect(kh.me.capabilities).not.toContain("invoice.book");
    expect(kh.me.capabilities).toContain("settings.manage");
    expect(jf.me.capabilities).toEqual(
      expect.arrayContaining(["invoice.book", "invoice.credit", "period.close", "payroll.export"]),
    );
  });

  it("projects: a project manager needs the create_projects right", async () => {
    const mb = await login("mb"); // project manager without the right
    const pd = await login("pd"); // project manager with the right (seed)
    expect(mb.me.capabilities).not.toContain("project.create");
    expect(pd.me.capabilities).toContain("project.create");
    const res = await post(mb.headers, "/projects", {
      name: "Må ikke oprettes",
      customerId: null,
      managerId: mb.me.id,
      contractType: "time_material",
      billable: true,
      commentRequired: false,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("sickness privacy (OQ-21)", () => {
  it("Management outside the reporting line sees 'Fravær'; Finance and the employee see the reason", async () => {
    const lv = await login("lv");
    const ob = await login("ob"); // used as an unrelated viewer
    const jf = await login("jf");
    const week = startOfIsoWeek("2026-09-15");
    await withTenant(db, lv.me.tenantId, async (tx) => {
      const mgmt: AuthContext = {
        userId: ob.me.id,
        tenantId: lv.me.tenantId,
        roles: ["employee", "management"],
        csrfToken: "",
      };
      const masked = await weekView(tx, mgmt, lv.me.id, week);
      const names = masked.rows.filter((r) => r.kind === "absence").map((r) => r.ref.nameDa);
      expect(names).toContain("Fravær");
      expect(names).not.toContain("Sygdom");
      const fin: AuthContext = {
        userId: jf.me.id,
        tenantId: lv.me.tenantId,
        roles: ["employee", "finance"],
        csrfToken: "",
      };
      expect((await weekView(tx, fin, lv.me.id, week)).rows.map((r) => r.ref.nameDa)).toContain("Sygdom");
    });
    const own = (await get(lv.headers, `/timesheet/week/${week}`)).json();
    expect(own.rows.map((r: { ref: { nameDa?: string } }) => r.ref.nameDa)).toContain("Sygdom");
  });
});

describe("audit log (spec R1–R2)", () => {
  it("Finance reads financial entries only; Admin/Management read everything", async () => {
    const jf = await login("jf");
    const kh = await login("kh");
    expect((await get(jf.headers, "/audit?entity=user_roles")).statusCode).toBe(403);
    const fin = (await get(jf.headers, "/audit?limit=200")).json();
    expect(
      fin.rows.every((r: { entity: string }) => r.entity !== "user_roles" && r.entity !== "tenant"),
    ).toBe(true);
    expect((await get(kh.headers, "/audit/entities")).json()).toEqual(
      expect.arrayContaining(["accounting_period"]),
    );
    expect((await get((await login("lv")).headers, "/audit")).statusCode).toBe(403);
  });
});

describe("GDPR (spec AC4, AC5)", () => {
  it("export contains the person's own data; erasure of an active employee is refused", async () => {
    const kh = await login("kh");
    const lv = await login("lv");
    const res = await get(kh.headers, `/admin/employees/${lv.me.id}/gdpr-export`);
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.profile.email).toBe("lv@demo.arcnordic.test");
    expect(data.timeEntries.length).toBeGreaterThan(0);
    expect(res.body).not.toContain("al@demo.arcnordic.test"); // nothing about others
    expect(
      (await post(kh.headers, `/admin/employees/${lv.me.id}/erase`, { reason: "Test" })).json().error,
    ).toBe("still_active");
    expect(
      (await get((await login("jf")).headers, `/admin/employees/${lv.me.id}/gdpr-export`)).statusCode,
    ).toBe(403);
  });

  it("erasing a former employee pseudonymises the profile and keeps bookkeeping data (rolled back)", async () => {
    const kh = await login("kh");
    const ek = await login("ek");
    const auth: AuthContext = { userId: kh.me.id, tenantId: kh.me.tenantId, roles: ["admin"], csrfToken: "" };
    await inRollback(kh.me.tenantId, async (tx) => {
      const before = await exportPersonalData(tx, auth, ek.me.id);
      const kept = before.timeEntries.filter((e) => e.status !== "draft").length;
      await tx.update(schema.users).set({ active: false }).where(eq(schema.users.id, ek.me.id));
      const r = await erasePerson(tx, auth, ek.me.id, "Fratrådt, sletning efter anmodning");
      expect(r.pseudonym.startsWith("Tidligere medarbejder #")).toBe(true);
      const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, ek.me.id));
      expect(u?.email.endsWith(".invalid")).toBe(true);
      expect(u?.passwordHash).toBeNull();
      const entries = await tx
        .select()
        .from(schema.timeEntries)
        .where(eq(schema.timeEntries.userId, ek.me.id));
      expect(entries.length).toBe(kept);
      expect(entries.every((e) => e.comment === null)).toBe(true);
      expect(
        await tx.select().from(schema.userCompetencies).where(eq(schema.userCompetencies.userId, ek.me.id)),
      ).toHaveLength(0);
      const sweep = await retentionSweep(tx, todayCopenhagen());
      expect(sweep.pastRetention.cutoff).toMatch(/^\d{4}-01-01$/);
    });
    // Rolled back: Emil is unchanged.
    expect((await login("ek")).me.fullName).toBe("Emil Krogh");
  });
});
