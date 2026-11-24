/**
 * Test helper: runs a test file under a given approval mode and puts the demo tenant's own mode back afterwards. The
 * demo seed uses "finance" (D-040); the M1/M2 core-loop tests walk the line manager flow, which is still a valid
 * mode. Test files run one at a time (vitest.config fileParallelism: false), so switching is safe. The tenants table
 * has row level security, so the tenant is found through a demo login and changed inside withTenant.
 */
import { type createDb, schema, withTenant } from "@arc-tid/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

type Db = ReturnType<typeof createDb>["db"];

/** Sets the demo tenant's approval mode to `mode`; returns a function that restores the previous mode. */
export async function useApprovalMode(
  app: FastifyInstance,
  db: Db,
  mode: string,
): Promise<() => Promise<void>> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/dev-login",
    payload: { email: "kh@demo.arcnordic.test", password: "demo1234" },
  });
  const cookie = `arc_sid=${res.cookies.find((c) => c.name === "arc_sid")?.value}`;
  const tenantId = (await app.inject({ url: "/api/v1/me", headers: { cookie } })).json().tenantId as string;
  const set = (m: string) =>
    withTenant(db, tenantId, (tx) =>
      tx.update(schema.tenants).set({ approvalMode: m }).where(eq(schema.tenants.id, tenantId)),
    );
  const [before] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ mode: schema.tenants.approvalMode })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId)),
  );
  await set(mode);
  return async () => {
    await set(before?.mode ?? "line_manager");
  };
}
