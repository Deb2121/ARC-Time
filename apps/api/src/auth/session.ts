/**
 * Session store — opaque random tokens in an httpOnly cookie; only their SHA-256 hash is stored in the database,
 * together with a per-session CSRF token. Session lookup runs before the tenant is known, via auth_get_session().
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type Db, schema, withTenant } from "@arc-tid/db";
import { eq, sql } from "drizzle-orm";

export const SESSION_COOKIE = "arc_sid";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h, sliding renewal is V2

/** Hex SHA-256 of a string (used so raw session tokens are never stored). */
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const token = (): string => randomBytes(32).toString("base64url");

export interface SessionInfo {
  userId: string;
  tenantId: string;
  csrfToken: string;
}

/** Creates a 12-hour session for the user in their tenant; returns the raw token (for the cookie) and the CSRF token. */
export async function createSession(
  db: Db,
  userId: string,
  tenantId: string,
): Promise<{ raw: string; csrf: string }> {
  const raw = token();
  const csrf = token();
  await withTenant(db, tenantId, (tx) =>
    tx.insert(schema.sessions).values({
      tokenHash: sha256(raw),
      tenantId,
      userId,
      csrfToken: csrf,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }),
  );
  return { raw, csrf };
}

/** Looks up a valid, unexpired session for an active user by raw token; null if none. */
export async function readSession(db: Db, raw: string): Promise<SessionInfo | null> {
  const rows = await db.execute<{ user_id: string; tenant_id: string; csrf_token: string }>(
    sql`select user_id, tenant_id, csrf_token from auth_get_session(${sha256(raw)})`,
  );
  const r = rows[0];
  return r ? { userId: r.user_id, tenantId: r.tenant_id, csrfToken: r.csrf_token } : null;
}

/** Deletes the session (logout). */
export async function deleteSession(db: Db, raw: string, tenantId: string): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(raw))),
  );
}

/** Constant-time string comparison (CSRF token check) to avoid timing leaks. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
