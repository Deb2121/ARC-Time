/**
 * Review fixes (D-025/D-026): segregation of duties (Admin cannot book, credit, close or export payroll), "create if
 * right" for projects, sickness privacy, the audit-log reader and GDPR export/erasure. Writes run in a rolled-back
 * transaction, so the demo database is unchanged.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { todayCopenhagen } from "@arc-tid/domain";
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
  // A pure Admin (no Finance role) is covered in packages/domain/src/access.test.ts; the demo Admin (Karen, D-030)
  // also holds Finance, so the API guard is exercised with a line manager / project manager instead.
  it("without the Finance role nobody can book, credit, close periods or export payroll", async () => {
    const al = await login("al"); // line manager + project manager
    const jf = await login("jf"); // Finance
    const [period] = (await get(jf.headers, "/periods")).json();
    const list = (await get(jf.headers, "/invoices?status=booked")).json();
    const invoice = (Array.isArray(list) ? list : list.items)?.[0];
    expect(invoice?.id).toBeTruthy();
    expect((await post(al.headers, `/periods/${period.id}/close`, {})).statusCode).toBe(403);
    expect((await post(al.headers, `/periods/${period.id}/reopen`, { reason: "x" })).statusCode).toBe(403);
    expect((await post(al.headers, `/invoices/${invoice.id}/book`)).statusCode).toBe(403);
    expect((await post(al.headers, `/invoices/${invoice.id}/credit`, {})).statusCode).toBe(403);
    expect((await post(al.headers, "/payroll/periods/2026-10-01/export")).statusCode).toBe(403);
    expect(al.me.capabilities).not.toContain("invoice.book");
    expect(jf.me.capabilities).toEqual(
      expect.arrayContaining(["invoice.book", "invoice.credit", "period.close", "payroll.export"]),
    );
  });

  it("Karen (Admin + Finance, D-030) reaches both settings and the finance transactions", async () => {
    const kh = await login("kh");
    expect(kh.me.capabilities).toEqual(
      expect.arrayContaining([
        "settings.manage",
        "invoice.book",
        "period.close",
        "payroll.export",
        "receivables.manage",
      ]),
    );
  });

  it("projects: only Admin creates cases (D-040) — not a project manager, not even with the old right, not Finance", async () => {
    const mb = await login("mb"); // project manager
    const pd = await login("pd"); // project manager who had the old create_projects right (seed)
    const jf = await login("jf"); // Finance only
    const kh = await login("kh"); // Admin (and Finance)
    expect(mb.me.capabilities).not.toContain("project.create");
    expect(pd.me.capabilities).not.toContain("project.create");
    expect(jf.me.capabilities).not.toContain("project.create");
    expect(kh.me.capabilities).toContain("project.create");
    const res = await post(mb.headers, "/projects", {
      name: "Må ikke oprettes",
      customerId: null,
      managerId: mb.me.id,
      contractType: "time_material",
      billable: true,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("sickness privacy (OQ-21)", () => {
  it("Management outside the reporting line sees 'Fravær'; Finance and the employee see the reason", async () => {
    const lv = await login("lv");
    const ob = await login("ob"); // used as an unrelated viewer
    const jf = await login("jf");
    await inRollback(lv.me.tenantId, async (tx) => {
      // Laura's own sick day (the random seed may not have one), in an empty week far ahead so nothing collides.
      const week = "2030-01-07";
      const [syg] = await tx
        .select({ id: schema.absenceCodes.id })
        .from(schema.absenceCodes)
        .where(eq(schema.absenceCodes.code, "SYG"));
      await tx.insert(schema.timeEntries).values({
        tenantId: lv.me.tenantId,
        userId: lv.me.id,
        date: week,
        absenceCodeId: syg?.id ?? null,
        hours: 7.5,
        billable: false,
        status: "draft",
      });
      const names = async (auth: AuthContext) =>
        (await weekView(tx, auth, lv.me.id, week)).rows
          .filter((r) => r.kind === "absence")
          .map((r) => r.ref.nameDa);
      const masked = await names({
        userId: ob.me.id,
        tenantId: lv.me.tenantId,
        roles: ["employee", "management"],
        csrfToken: "",
      });
      expect(masked).toContain("Fravær");
      expect(masked).not.toContain("Sygdom");
      expect(
        await names({
          userId: jf.me.id,
          tenantId: lv.me.tenantId,
          roles: ["employee", "finance"],
          csrfToken: "",
        }),
      ).toContain("Sygdom");
      expect(
        await names({ userId: lv.me.id, tenantId: lv.me.tenantId, roles: lv.me.roles, csrfToken: "" }),
      ).toContain("Sygdom");
    });
  });
});

describe("audit log (spec R1–R2)", () => {
  it("Finance, Admin and Management read everything (D-029); employees nothing", async () => {
    const jf = await login("jf");
    const kh = await login("kh");
    expect((await get(jf.headers, "/audit?entity=user_roles")).statusCode).toBe(200);
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
