/**
 * Personal API tokens for the analytics service (spec integrations R10, decision D-028) — GRASP Pure Fabrication.
 * Power BI and Excel cannot use the browser sign-in, so a Finance/Management/Admin user creates a named,
 * read-only token here and pastes it into Power BI as an `Authorization: Bearer …` header. Only the SHA-256 hash is
 * stored; the raw token is returned once. Tokens expire after a year and can be revoked at any time. Audited.
 */
import { createHash, randomBytes } from "node:crypto";
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";

const PREFIX = "arct_";
const MAX_ACTIVE = 10;

/** SHA-256 hex of a raw token (the only form stored). */
const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** The caller's tokens, newest first (never the token itself). */
export async function listTokens(tx: Tx, auth: AuthContext) {
  return tx
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      prefix: schema.apiTokens.prefix,
      createdAt: schema.apiTokens.createdAt,
      expiresAt: schema.apiTokens.expiresAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      revokedAt: schema.apiTokens.revokedAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, auth.userId))
    .orderBy(desc(schema.apiTokens.createdAt));
}

/** Creates a read-only analytics token for the caller; returns the raw token once. */
export async function createToken(tx: Tx, auth: AuthContext, name: string) {
  const active = await tx
    .select({ id: schema.apiTokens.id })
    .from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.userId, auth.userId), isNull(schema.apiTokens.revokedAt)));
  if (active.length >= MAX_ACTIVE) throw new AppError(409, "too_many_tokens");
  const raw = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const [row] = await tx
    .insert(schema.apiTokens)
    .values({
      tenantId: auth.tenantId,
      userId: auth.userId,
      name,
      tokenHash: hash(raw),
      prefix: raw.slice(0, 9),
      expiresAt,
    })
    .returning({ id: schema.apiTokens.id });
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "api_token",
    entityId: row?.id ?? "",
    action: "create",
    userId: auth.userId,
    after: { name, expiresAt },
  });
  return { id: row?.id, name, token: raw, expiresAt };
}

/** Revokes one of the caller's tokens (Power BI stops refreshing at once). */
export async function revokeToken(tx: Tx, auth: AuthContext, id: string) {
  const [row] = await tx
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiTokens.id, id),
        eq(schema.apiTokens.userId, auth.userId),
        isNull(schema.apiTokens.revokedAt),
      ),
    )
    .returning({ id: schema.apiTokens.id });
  if (!row) throw new AppError(404, "not_found");
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "api_token",
    entityId: id,
    action: "revoke",
    userId: auth.userId,
  });
  return { revoked: true };
}
