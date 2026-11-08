/**
 * Audit trail writer (brief §4.15: every change to financial data is logged — who, when, before → after, reason).
 * GRASP: Pure Fabrication — one place that knows how an audit record is stored; callers stay focused on their workflow.
 * The audit_log table is append-only for the app role (see drizzle/0001_rls.sql).
 */
import type { Tx } from "./client.ts";
import { auditLog } from "./schema.ts";

export interface AuditEntry {
  tenantId: string;
  entity: string;
  entityId: string;
  action: "create" | "update" | "delete" | (string & {});
  userId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Writes an audit record inside the caller's transaction, so the change and its audit trail commit together. */
export async function writeAudit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: e.tenantId,
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    userId: e.userId,
    before: e.before ?? null,
    after: e.after ?? null,
    reason: e.reason ?? null,
  });
}
