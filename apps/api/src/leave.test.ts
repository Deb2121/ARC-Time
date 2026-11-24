/**
 * Leave accounts (D-037) against the seeded database: monthly accrual, approved leave drawn, manual postings,
 * individual feriefridage and who may see and change what. Writes run in a rolled-back transaction.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { addLeaveAdjustment, leaveAccounts, setExtraHoliday } from "./services/leave.ts";

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

beforeAll(async () => {
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app.close();
  await close();
});

describe("leave accounts", () => {
  it("ferie: 2,08 per ended month, approved leave drawn, balance = opening + earned − taken", async () => {
    const lv = await me("lv");
    const r = (await app.inject({ url: "/api/v1/leave/accounts", headers: { cookie: lv.cookie } })).json();
    const ferie = r.accounts.find((a: { account: string }) => a.account === "ferie");
    const accruals = ferie.lines.filter((l: { kind: string }) => l.kind === "accrual");
    expect(accruals.length).toBeGreaterThan(0);
    for (const a of accruals) {
      expect(a.days).toBe(208);
      // posted on a month's last day
      const d = new Date(`${a.date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      expect(d.getUTCDate()).toBe(1);
    }
    const taken = ferie.lines
      .filter((l: { kind: string }) => l.kind === "taken")
      .reduce((s: number, l: { days: number }) => s + l.days, 0);
    expect(ferie.balance).toBe(ferie.opening + ferie.earned + taken);
    expect(ferie.used).toBe(-taken);
  });

  it("a manual posting moves the balance and is audited; only Finance/Admin may post", async () => {
    const lv = await me("lv");
    const jf = await me("jf");
    await inRollback(lv.tenantId, async (tx) => {
      const before = (await leaveAccounts(tx, authOf(jf, ["finance", "employee"]), lv.id)).accounts[0];
      await addLeaveAdjustment(tx, authOf(jf, ["finance", "employee"]), {
        userId: lv.id,
        account: "ferie",
        date: "2026-11-02",
        days: 2.5,
        text: "Overført fra ferieår 2025/26",
      });
      const after = (await leaveAccounts(tx, authOf(jf, ["finance", "employee"]), lv.id)).accounts[0];
      expect((after?.balance ?? 0) - (before?.balance ?? 0)).toBe(250);
      const [audit] = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.entity, "leave"));
      expect(audit?.action).toBe("create");
      await expect(
        addLeaveAdjustment(tx, authOf(lv, ["employee"]), {
          userId: lv.id,
          account: "ferie",
          date: "2026-11-02",
          days: 5,
          text: "x",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  it("feriefridage: an individual rate of ½ day accrues 0,50 per month; 0 = none", async () => {
    const lv = await me("lv");
    const jf = await me("jf");
    await inRollback(lv.tenantId, async (tx) => {
      const fin = authOf(jf, ["finance", "employee"]);
      const none = (await leaveAccounts(tx, fin, lv.id)).accounts[1];
      expect(none?.perMonth).toBe(0);
      expect(none?.lines).toHaveLength(0);
      await setExtraHoliday(tx, fin, lv.id, { perMonth: 0.5 });
      const fri = (await leaveAccounts(tx, fin, lv.id)).accounts[1];
      expect(fri?.perMonth).toBe(50);
      expect(fri?.lines.every((l) => l.kind !== "accrual" || l.days === 50)).toBe(true);
      expect(fri?.earned).toBe(50 * (fri?.lines.filter((l) => l.kind === "accrual").length ?? 0));
    });
  });

  it("an employee cannot see a colleague's account; Finance can", async () => {
    const lv = await me("lv");
    const ob = await me("ob");
    const jf = await me("jf");
    expect(
      (await app.inject({ url: `/api/v1/leave/accounts?userId=${ob.id}`, headers: { cookie: lv.cookie } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/api/v1/leave/accounts?userId=${ob.id}`, headers: { cookie: jf.cookie } }))
        .statusCode,
    ).toBe(200);
  });
});
