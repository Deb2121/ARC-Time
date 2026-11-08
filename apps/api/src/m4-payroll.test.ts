/**
 * M4 payroll export (docs/spec/payroll.md AC1–AC4, AC7). Locking a pay period cannot be undone, so the export/lock
 * flow runs inside one database transaction that is rolled back at the end — the dev database is left untouched.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { addDays, dailyNorm, isoWeekday, lastDayOfMonth } from "@arc-tid/domain";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { loadEmployee, normContext } from "./services/calendar.ts";
import { exportPayroll, lockPayPeriod, payPeriods, payrollFile, payrollPreview } from "./services/payroll.ts";

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

describe("payroll export", () => {
  it("AC7: only Finance may use the payroll export", async () => {
    const lv = await me("lv");
    expect(
      (await app.inject({ url: "/api/v1/payroll/periods", headers: { cookie: lv.cookie } })).statusCode,
    ).toBe(403);
    const jf = await me("jf");
    expect(
      (await app.inject({ url: "/api/v1/payroll/periods", headers: { cookie: jf.cookie } })).statusCode,
    ).toBe(200);
  });

  it("AC1–AC4: export, re-export replaces, missing payroll number left out, lock, late line next month", async () => {
    const jf = await me("jf");
    const lv = await me("lv");
    const auth: AuthContext = {
      userId: jf.id,
      tenantId: jf.tenantId,
      roles: ["finance", "employee"],
      csrfToken: "",
    };
    await inRollback(jf.tenantId, async (tx) => {
      const periods = await payPeriods(tx, auth);
      const sep = periods.find((p) => p.month === "2026-09-01");
      expect(sep).toBeTruthy();

      // Export and lock every month up to and including September, in order.
      for (const p of periods.filter((x) => x.month <= "2026-09-01")) {
        const first = await exportPayroll(tx, auth, p.month);
        const again = await exportPayroll(tx, auth, p.month); // AC4: replaces, no duplicates
        expect(again.lineCount).toBe(first.lineCount);
        const runs = await tx
          .select()
          .from(schema.payrollRuns)
          .where(eq(schema.payrollRuns.payPeriodId, p.id));
        expect(runs).toHaveLength(1);
        await lockPayPeriod(tx, auth, p.month);
      }
      const sepPreview = await payrollPreview(tx, auth, "2026-09-01");
      expect(sepPreview.period.status).toBe("locked");
      const sepFile = (await payrollFile(tx, "2026-09-01")).csv;
      expect(sepFile.split("\r\n")[0]).toContain("employee_number;employee_name;salary_code");

      // AC2: Frederik (no payroll number) is never in the file.
      expect(sepFile).not.toContain("Frederik");

      // AC3: a sick day dated in locked September is approved now → late line in October with original period.
      let day = "2026-09-07";
      const existing = await tx
        .select({ date: schema.timeEntries.date })
        .from(schema.timeEntries)
        .where(eq(schema.timeEntries.userId, lv.id));
      const taken = new Set(
        existing.filter((e) => e.date >= "2026-09-01" && e.date <= "2026-09-30").map((e) => e.date),
      );
      for (let d = "2026-09-01"; d <= lastDayOfMonth("2026-09-01"); d = addDays(d, 1))
        if (isoWeekday(d) <= 5 && !taken.has(d)) {
          day = d;
          break;
        }
      const emp = await loadEmployee(tx, lv.id);
      const norm = emp ? dailyNorm(day, await normContext(tx, emp)) : 0;
      expect(norm).toBeGreaterThan(0);
      const [syg] = await tx
        .select()
        .from(schema.absenceCodes)
        .where(and(eq(schema.absenceCodes.code, "SYG")));
      await tx.insert(schema.timeEntries).values({
        tenantId: jf.tenantId,
        userId: lv.id,
        date: day,
        absenceCodeId: syg?.id,
        hours: norm / 100,
        status: "approved",
      });

      const oct = await payrollPreview(tx, auth, "2026-10-01");
      const laura = oct.rows.find((r) => r.userId === lv.id);
      expect(laura?.lines).toContainEqual(
        expect.objectContaining({ code: "SYG", originalPeriod: "2026-09", quantity: 1 }),
      );
      await exportPayroll(tx, auth, "2026-10-01");
      expect((await payrollFile(tx, "2026-10-01")).csv).toMatch(
        /;SYG;40;Sygdom;1,00;dage;;;2026-10-01;2026-10-31;2026-09;1/,
      );
      // September's file is unchanged.
      expect((await payrollFile(tx, "2026-09-01")).csv).toBe(sepFile);
      // Locking requires an export, and a locked month cannot be exported again.
      await expect(exportPayroll(tx, auth, "2026-09-01")).rejects.toMatchObject({
        code: "pay_period_locked",
      });
    });
    // Nothing persisted.
    const left = await withTenant(db, jf.tenantId, (tx) => tx.select().from(schema.payrollRuns));
    expect(left).toHaveLength(0);
  });

  it("AC1: approved vacation days are exported as days on FERIE", async () => {
    const jf = await me("jf");
    const auth: AuthContext = { userId: jf.id, tenantId: jf.tenantId, roles: ["finance"], csrfToken: "" };
    await withTenant(db, jf.tenantId, async (tx) => {
      const periods = await payPeriods(tx, auth);
      const anyFerie = [];
      for (const p of periods) {
        const prev = await payrollPreview(tx, auth, p.month);
        anyFerie.push(...prev.rows.flatMap((r) => r.lines.filter((l) => l.code === "FERIE")));
      }
      expect(anyFerie.length).toBeGreaterThan(0);
      for (const l of anyFerie) expect(l.unit).toBe("days");
    });
  });
});
