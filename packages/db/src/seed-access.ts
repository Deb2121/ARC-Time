/**
 * Fictional seed for extra rights (D-025): Anne Lund (AL) and Peter Dahl (PD) may create projects; the other project
 * managers may not. Idempotent: only runs when the tenant has no rights yet, so an Admin's later changes are kept.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "./client.ts";
import * as s from "./schema.ts";

/** Grants the demo rights once. Returns true when something was added. */
export async function seedAccess(tx: Tx, tenantId: string): Promise<boolean> {
  const [existing] = await tx.select().from(s.userRights).where(eq(s.userRights.tenantId, tenantId)).limit(1);
  if (existing) return false;
  const people = await tx
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), inArray(s.users.initials, ["AL", "PD"])));
  if (!people.length) return false;
  await tx
    .insert(s.userRights)
    .values(people.map((p) => ({ tenantId, userId: p.id, right: "create_projects" })));
  return true;
}
