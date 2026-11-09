/**
 * Audit log reader (docs/spec/administration.md R1–R2, decision D-025) — GRASP Pure Fabrication. The log itself is
 * written everywhere through `writeAudit` (packages/db/src/audit.ts) and is append-only in the database (the app
 * role has no UPDATE/DELETE on audit_log). This file only reads it, scoped by AccessPolicy: Management and Admin
 * see everything, Finance sees the financial entities.
 */
import { schema, type Tx } from "@arc-tid/db";
import { FINANCIAL_AUDIT_ENTITIES } from "@arc-tid/domain";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";

/** Filters for the audit screen; `before` is the cursor (the `at` of the last row already shown). */
export interface AuditFilter {
  entity?: string | undefined;
  action?: string | undefined;
  userId?: string | undefined;
  entityId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  before?: string | undefined;
  limit?: number | undefined;
}

/** Entity types the caller may filter on (only those present in the log). */
export async function auditEntities(tx: Tx, auth: AuthContext): Promise<string[]> {
  const policy = policyOf(auth);
  if (!policy.can("audit.read")) throw new AppError(403, "forbidden");
  const rows = await tx.selectDistinct({ entity: schema.auditLog.entity }).from(schema.auditLog);
  return rows
    .map((r) => r.entity)
    .filter((e) => policy.canReadAudit(e))
    .sort();
}

/**
 * Newest-first page of audit rows the caller may read, with the actor's name. Returns `next` (cursor) when more
 * rows exist. Before/after are the JSON snapshots written at the time; `reason` is the user's justification.
 */
export async function readAuditLog(tx: Tx, auth: AuthContext, f: AuditFilter) {
  const policy = policyOf(auth);
  if (!policy.can("audit.read")) throw new AppError(403, "forbidden");
  if (f.entity && !policy.canReadAudit(f.entity)) throw new AppError(403, "forbidden");
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await tx
    .select({
      id: schema.auditLog.id,
      at: schema.auditLog.at,
      entity: schema.auditLog.entity,
      entityId: schema.auditLog.entityId,
      action: schema.auditLog.action,
      userId: schema.auditLog.userId,
      actor: schema.users.fullName,
      before: schema.auditLog.before,
      after: schema.auditLog.after,
      reason: schema.auditLog.reason,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .where(
      and(
        policy.can("audit.read_all")
          ? undefined
          : inArray(schema.auditLog.entity, [...FINANCIAL_AUDIT_ENTITIES]),
        f.entity ? eq(schema.auditLog.entity, f.entity) : undefined,
        f.action ? eq(schema.auditLog.action, f.action) : undefined,
        f.userId ? eq(schema.auditLog.userId, f.userId) : undefined,
        f.entityId ? eq(schema.auditLog.entityId, f.entityId) : undefined,
        f.from ? gte(schema.auditLog.at, new Date(`${f.from}T00:00:00Z`)) : undefined,
        f.to
          ? lte(schema.auditLog.at, sql`${`${f.to}T00:00:00Z`}::timestamptz + interval '1 day'`)
          : undefined,
        f.before ? lt(schema.auditLog.at, new Date(f.before)) : undefined,
      ),
    )
    .orderBy(desc(schema.auditLog.at))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return { rows: page, next: rows.length > limit ? page.at(-1)?.at.toISOString() : null };
}
