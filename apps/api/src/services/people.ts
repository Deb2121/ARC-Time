/**
 * Who may see or approve whom (docs/spec/overview.md §3, decision D-013). Always evaluated server-side.
 */
import { schema, type Tx } from "@arc-tid/db";
import { hasRole } from "@arc-tid/domain";
import { eq, sql } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";

/** Direct and indirect reports of a manager. */
export async function reportIds(tx: Tx, managerId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive r as (
      select id from users where manager_id = ${managerId}
      union
      select u.id from users u join r on u.manager_id = r.id
    ) select id from r`);
  return rows.map((x) => x.id);
}

/** Users whose time the caller may read: self, reports (line manager), everyone (admin/finance/management). */
export async function visibleUserIds(tx: Tx, auth: AuthContext): Promise<string[] | "all"> {
  if (hasRole(auth.roles, "admin", "finance", "management")) return "all";
  const ids = [auth.userId];
  if (hasRole(auth.roles, "line_manager")) ids.push(...(await reportIds(tx, auth.userId)));
  return ids;
}

/**
 * How the caller relates to an employee, for privacy rules (AccessPolicy.seesAbsenceReason): the employee
 * themself, their line manager (direct or indirect), or anyone else.
 */
export async function relationTo(
  tx: Tx,
  auth: AuthContext,
  userId: string,
): Promise<"self" | "line_manager" | "other"> {
  if (userId === auth.userId) return "self";
  if (hasRole(auth.roles, "line_manager") && (await reportIds(tx, auth.userId)).includes(userId))
    return "line_manager";
  return "other";
}

/** True if the caller may read the user's time data (self, a report of a line manager, or Admin/Finance/Management). */
export async function canViewUser(tx: Tx, auth: AuthContext, userId: string): Promise<boolean> {
  const v = await visibleUserIds(tx, auth);
  return v === "all" || v.includes(userId);
}

/**
 * Approver rule (D-013, D-025): the direct line manager approves. People without a manager (e.g. the CEO) are
 * approved by Finance (never by themselves). Nobody approves their own timesheet.
 */
export async function canApproveUser(tx: Tx, auth: AuthContext, userId: string): Promise<boolean> {
  if (userId === auth.userId) return false;
  const [u] = await tx
    .select({ managerId: schema.users.managerId })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!u) return false;
  if (u.managerId) return u.managerId === auth.userId;
  return policyOf(auth).can("timesheet.approve_unmanaged");
}

/** Users the caller approves (for the inbox). */
export async function approveeIds(tx: Tx, auth: AuthContext): Promise<string[]> {
  const direct = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.managerId, auth.userId));
  const ids = direct.map((d) => d.id);
  if (policyOf(auth).can("timesheet.approve_unmanaged")) {
    const top = await tx.execute<{ id: string }>(
      sql`select id from users where manager_id is null and id <> ${auth.userId}`,
    );
    ids.push(...top.map((t) => t.id));
  }
  return ids;
}
