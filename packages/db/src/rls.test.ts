/**
 * Integration test for tenant isolation (decision D-012). Requires the dev database (`pnpm db:up && pnpm db:migrate`).
 * Runs as the restricted runtime role arc_app.
 */
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
const run = ownerUrl && appUrl ? describe : describe.skip;

run("row-level security", () => {
  const owner = postgres(ownerUrl ?? "", { max: 1 });
  const app = postgres(appUrl ?? "", { max: 1 });
  let tenantA = "";
  let tenantB = "";

  beforeAll(async () => {
    const [a] =
      await owner`insert into tenants (name, slug) values ('RLS A', ${`rls-a-${Date.now()}`}) returning id`;
    const [b] =
      await owner`insert into tenants (name, slug) values ('RLS B', ${`rls-b-${Date.now()}`}) returning id`;
    tenantA = a?.id;
    tenantB = b?.id;
    await owner`insert into legal_entities (tenant_id, name) values (${tenantA}, 'A entity'), (${tenantB}, 'B entity')`;
  });

  afterAll(async () => {
    await owner`delete from legal_entities where tenant_id in (${tenantA}, ${tenantB})`;
    await owner`delete from audit_log where tenant_id in (${tenantA}, ${tenantB})`;
    await owner`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await owner.end();
    await app.end();
  });

  const asTenant = <T>(tenantId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) =>
    app.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(sql);
    }) as Promise<T>;

  it("sees nothing without a tenant context", async () => {
    const rows = await app`select id from legal_entities`;
    expect(rows.length).toBe(0);
  });

  it("sees only its own tenant's rows", async () => {
    const rows = await asTenant(tenantA, (sql) => sql`select name from legal_entities`);
    expect(rows.map((r) => r.name)).toEqual(["A entity"]);
  });

  it("cannot insert rows for another tenant", async () => {
    await expect(
      asTenant(
        tenantA,
        (sql) => sql`insert into legal_entities (tenant_id, name) values (${tenantB}, 'sneaky')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("audit log is append-only for the app role", async () => {
    await asTenant(
      tenantA,
      (sql) =>
        sql`insert into audit_log (tenant_id, entity, entity_id, action) values (${tenantA}, 'x', '1', 'create')`,
    );
    await expect(asTenant(tenantA, (sql) => sql`update audit_log set action = 'tampered'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asTenant(tenantA, (sql) => sql`delete from audit_log`)).rejects.toThrow(/permission denied/);
  });

  it("every table with a tenant_id column has row-level security enabled", async () => {
    const rows = await owner`
      select c.relname as table, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id')`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.rls).map((r) => r.table)).toEqual([]);
  });
});
