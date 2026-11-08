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
