/**
 * Finance feedback, step 1 (2026-11-17): company car vs own car on mileage, and the "viderefaktureres til kunden"
 * choice when a case is created. Runs inside transactions that are rolled back — the dev database is left untouched.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { kr } from "@arc-tid/domain";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { saveExpense } from "./services/expenses.ts";
import { payrollPreview } from "./services/payroll.ts";
import { addTask, createProject } from "./services/project-setup.ts";

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

describe("mileage: own car or company car", () => {
  it("42,5 km in own car → 167,45 kr to payroll; the same trip in a company car → nothing to payroll", async () => {
    const lv = await me("lv");
    const jf = await me("jf");
    await inRollback(lv.tenantId, async (tx) => {
      const lvAuth = authOf(lv, ["employee"]);
      const mileageTotal = async () => {
        const p = await payrollPreview(tx, authOf(jf, ["finance", "employee"]), "2026-11-01");
        const row = p.rows.find((r) => r.userId === lv.id);
        return (row?.lines ?? [])
          .filter((l) => l.unit === "km" || /kørsel/i.test(l.name))
          .reduce((a, l) => a + (l.amount ?? 0), 0);
      };
      const before = await mileageTotal();
      const trip = { date: "2026-11-16", kind: "mileage" as const, description: "Byggemøde", km: 42.5 };
      const company = await saveExpense(tx, lvAuth, { ...trip, vehicle: "company" });
      const own = await saveExpense(tx, lvAuth, { ...trip, vehicle: "own" });
      expect(company?.vehicle).toBe("company");
      // the company-car trip keeps its value so it can be re-invoiced
      expect(company?.grossAmount).toBe(kr(167.45));
      expect(own?.vehicle).toBe("own");
      // the customer is charged 4,50 kr/km for both cars: 42,5 × 4,50 = 191,25
      expect(company?.billAmount).toBe(kr(191.25));
      expect(own?.billAmount).toBe(kr(191.25));
      await tx.update(schema.expenses).set({ status: "approved" }).where(eq(schema.expenses.userId, lv.id));
      const after = await mileageTotal();
      expect(after - before).toBe((own?.grossAmount ?? 0) + 0);
    });
  });
});

describe("Viderefaktureres til kunden", () => {
  it("an internal case cannot be re-invoiced", async () => {
    const jf = await me("jf");
    await inRollback(jf.tenantId, async (tx) => {
      await expect(
        createProject(tx, authOf(jf, ["finance", "employee"]), {
          name: "Intern udvikling",
          customerId: null,
          managerId: jf.id,
          contractType: "time_material",
          billable: true,
        }),
      ).rejects.toMatchObject({ code: "billable_needs_customer" });
    });
  });

  it("a customer case marked Nej gets non-billable tasks; omitted means Ja", async () => {
    const jf = await me("jf");
    await inRollback(jf.tenantId, async (tx) => {
      const auth = authOf(jf, ["finance", "employee"]);
      const [customer] = await tx.select().from(schema.customers).limit(1);
      const base = {
        customerId: customer?.id ?? null,
        managerId: jf.id,
        contractType: "fixed_price" as const,
        price: 10_000,
      };
      const no = await createProject(tx, auth, { ...base, name: "Tilbud uden betaling", billable: false });
      expect(no.billable).toBe(false);
      const task = await addTask(tx, auth, no.id, {
        parentId: null,
        name: "Tilbudsarbejde",
        budgetHours: 8,
        budgetAmount: 0,
      });
      expect(task?.billable).toBe(false);
      const yes = await createProject(tx, auth, { ...base, name: "Almindelig sag" });
      expect(yes.billable).toBe(true);
      const [contract] = await tx
        .select()
        .from(schema.contracts)
        .where(eq(schema.contracts.projectId, yes.id));
      expect(contract?.type).toBe("fixed_price");
    });
  });

  it("Medgået tid med loft stores the cap in hours; a cap on fastpris is refused", async () => {
    const jf = await me("jf");
    await inRollback(jf.tenantId, async (tx) => {
      const auth = authOf(jf, ["finance", "employee"]);
      const [customer] = await tx.select().from(schema.customers).limit(1);
      const base = { customerId: customer?.id ?? null, managerId: jf.id };
      const p = await createProject(tx, auth, {
        ...base,
        name: "Rådgivning med loft",
        contractType: "time_material",
        hourlyRate: 1000,
        maxHours: 200,
      });
      const [contract] = await tx.select().from(schema.contracts).where(eq(schema.contracts.projectId, p.id));
      expect(contract?.name).toBe("Medgået tid med loft");
      expect(Number(contract?.maxHours)).toBe(200);
      await expect(
        createProject(tx, auth, {
          ...base,
          name: "x",
          contractType: "fixed_price",
          price: 1000,
          maxHours: 10,
        }),
      ).rejects.toMatchObject({ code: "cap_needs_time_material" });
    });
  });

  it("new time-and-material contracts are named Medgået tid", async () => {
    const jf = await me("jf");
    await inRollback(jf.tenantId, async (tx) => {
      const [customer] = await tx.select().from(schema.customers).limit(1);
      const p = await createProject(tx, authOf(jf, ["finance", "employee"]), {
        name: "Løbende rådgivning",
        customerId: customer?.id ?? null,
        managerId: jf.id,
        contractType: "time_material",
      });
      const [contract] = await tx.select().from(schema.contracts).where(eq(schema.contracts.projectId, p.id));
      expect(contract?.name).toBe("Medgået tid");
    });
  });
});
