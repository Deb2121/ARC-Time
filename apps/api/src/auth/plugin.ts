/**
 * Authentication + CSRF. Resolves the session cookie to a user and tenant, loads roles, and exposes
 * `request.auth` and `request.withTenant()`. Mutating requests must echo the session's CSRF token in the
 * `x-csrf-token` header (synchroniser token; cookie is SameSite=Lax as defence in depth).
 */
import { type Db, schema, type Tx, withTenant } from "@arc-tid/db";
import type { Role } from "@arc-tid/domain";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { AppError } from "../services/errors.ts";
import { readSession, SESSION_COOKIE, safeEqual } from "./session.ts";

export interface AuthContext {
  userId: string;
  tenantId: string;
  roles: Role[];
  csrfToken: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
    withTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  }
  interface FastifyContextConfig {
    /** route is reachable without a session */
    public?: boolean;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Fastify plugin: resolves the session cookie to `request.auth`, adds `request.withTenant()`, and enforces login
 * and the CSRF header on every route not marked `config: { public: true }`.
 */
export const authPlugin = fp(async (app: FastifyInstance, opts: { db: Db }) => {
  const { db } = opts;
  app.decorateRequest("auth", null);
  app.decorateRequest("withTenant", function <T>(this: FastifyRequest, fn: (tx: Tx) => Promise<T>) {
    if (!this.auth) throw new AppError(401, "unauthenticated");
    return withTenant(db, this.auth.tenantId, fn);
  });

  app.addHook("preHandler", async (req: FastifyRequest, _reply: FastifyReply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const s = await readSession(db, raw);
      if (s) {
        const roles = await withTenant(db, s.tenantId, (tx) =>
          tx
            .select({ role: schema.userRoles.role })
            .from(schema.userRoles)
            .where(eq(schema.userRoles.userId, s.userId)),
        );
        req.auth = { ...s, roles: roles.map((r) => r.role) };
      }
    }
    if (req.routeOptions.config?.public) return;
    if (!req.auth) throw new AppError(401, "unauthenticated");
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers["x-csrf-token"];
      if (typeof header !== "string" || !safeEqual(header, req.auth.csrfToken)) {
        throw new AppError(403, "csrf_failed");
      }
    }
  });
});

/** Returns the auth context if the caller has at least one of the roles, otherwise throws 401/403. */
export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthContext {
  const a = req.auth;
  if (!a) throw new AppError(401, "unauthenticated");
  if (!roles.some((r) => a.roles.includes(r))) throw new AppError(403, "forbidden");
  return a;
}
