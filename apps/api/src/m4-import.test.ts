/**
 * M4 data import (D-024): dry run with per-row errors, permissions, and a real import of customers → projects →
 * employees (incl. a manager defined later in the same file). Writes run in a rolled-back transaction.
 */
import { createDb, schema, type Tx, withTenant } from "@arc-tid/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import type { AuthContext } from "./auth/plugin.ts";
import { loadConfig } from "./config.ts";
import { commitImport, previewImport } from "./services/data-import.ts";

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
  const me = (await app.inject({ url: "/api/v1/me", headers: { cookie } })).json();
  return {
    headers: { cookie, "x-csrf-token": res.json().csrfToken as string },
    id: me.id as string,
    tenantId: me.tenantId as string,
  };
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

describe("data import", () => {
  it("dry run shows create/update and readable errors per row, without writing", async () => {
    const kh = await login("kh");
    const csv = "Kundenummer;Navn;CVR\r\n1001;Opdateret navn;\r\n;Ny kunde ApS;12345678\r\n;;123\r\n";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/import/customers/preview",
      headers: kh.headers,
      payload: { csv },
    });
    const p = res.json();
    expect(p.counts).toEqual({ create: 2, update: 1, errors: 1 });
    expect(p.rows[2]).toMatchObject({ line: 4, errors: ["missing_name", "bad_cvr"] });
    const commit = await app.inject({
      method: "POST",
      url: "/api/v1/import/customers/commit",
      headers: kh.headers,
      payload: { csv },
    });
    expect(commit.statusCode).toBe(422);
  });

  it("employees can only be imported by Admin; Finance may import customers", async () => {
    const jf = await login("jf");
    const csv = "email;navn;initialer;ansat fra\r\nx@y.dk;X;X;01-01-2026\r\n";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/import/employees/preview",
          headers: jf.headers,
          payload: { csv },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/import/customers/preview",
          headers: jf.headers,
          payload: { csv: "navn\r\nA\r\n" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("imports customers, projects and employees in one go (rolled back afterwards)", async () => {
    const kh = await login("kh");
    const auth: AuthContext = {
      userId: kh.id,
      tenantId: kh.tenantId,
      roles: ["admin", "employee"],
      csrfToken: "",
    };
    await inRollback(kh.tenantId, async (tx) => {
      const c = await commitImport(
        tx,
        auth,
        "customers",
        "kundenummer;navn;cvr;betalingsfrist\r\n9001;Testkunde A/S;87654321;14\r\n",
      );
      expect(c).toEqual({ created: 1, updated: 0 });

      const emp = await commitImport(
        tx,
        auth,
        "employees",
        [
          "email;navn;initialer;afdeling;leder;roller;ansat fra;lønnummer;feriesaldo",
          "ny.medarbejder@firma.test;Ny Medarbejder;NM;Ny afdeling;ny.leder@firma.test;;01-12-2026;2001;12,5",
          "ny.leder@firma.test;Ny Leder;NL2;Ny afdeling;kh@demo.arcnordic.test;leder, projektleder;01-12-2026;2002;",
        ].join("\r\n"),
      );
      expect(emp).toEqual({ created: 2, updated: 0 });
      const [nm] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, "ny.medarbejder@firma.test"));
      const [lead] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, "ny.leder@firma.test"));
      expect(nm?.managerId).toBe(lead?.id);
      expect(nm?.vacationOpening).toBe(12.5);
      expect(nm?.passwordHash).toBeNull();
      const roles = (
        await tx
          .select()
          .from(schema.userRoles)
          .where(eq(schema.userRoles.userId, lead?.id ?? ""))
      )
        .map((r) => r.role)
        .sort();
      expect(roles).toEqual(["employee", "line_manager", "project_manager"]);
      expect(
        (
          await tx
            .select()
            .from(schema.employeeNorms)
            .where(eq(schema.employeeNorms.userId, nm?.id ?? ""))
        ).length,
      ).toBe(1);

      const prj = await commitImport(
        tx,
        auth,
        "projects",
        "projektnummer;navn;kundenummer;projektleder;aftaletype;timepris;startdato\r\n25099;Importeret projekt;9001;ny.leder@firma.test;regning;975;01-12-2026\r\n",
      );
      expect(prj).toEqual({ created: 1, updated: 0 });
      const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.number, "25099"));
      expect(project?.managerId).toBe(lead?.id);
      const tasks = await tx
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.projectId, project?.id ?? ""));
      expect(tasks.map((t) => t.name)).toEqual(["Generelt"]);

      // Re-importing the same project number updates instead of duplicating.
      const again = await previewImport(
        tx,
        "projects",
        "projektnummer;navn;projektleder\r\n25099;Nyt navn;ny.leder@firma.test\r\n",
      );
      expect(again.counts).toEqual({ create: 0, update: 1, errors: 0 });
    });
    const left = await withTenant(db, kh.tenantId, (tx) =>
      tx.select().from(schema.users).where(eq(schema.users.email, "ny.leder@firma.test")),
    );
    expect(left).toHaveLength(0);
  });
});
