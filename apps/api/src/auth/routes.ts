import { type Db, schema, withTenant } from "@arc-tid/db";
import { verify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import type { FastifyReply } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import * as oidc from "openid-client";
import { z } from "zod";
import type { Config } from "../config.ts";
import { HttpError } from "./plugin.ts";
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_MS } from "./session.ts";

const OIDC_COOKIE = "arc_oidc";

export const authRoutes: FastifyPluginAsyncZod<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const isProd = config.NODE_ENV === "production";

  const setSessionCookie = (reply: FastifyReply, raw: string) =>
    reply.setCookie(SESSION_COOKIE, raw, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });

  app.get("/auth/providers", { config: { public: true } }, async () => ({
    devLogin: config.devLoginEnabled,
    entra: config.entraEnabled,
  }));

  if (config.devLoginEnabled) {
    app.post(
      "/auth/dev-login",
      {
        config: { public: true, rateLimit: { max: config.AUTH_RATE_LIMIT, timeWindow: "1 minute" } },
        schema: {
          body: z.object({ email: z.string().email(), password: z.string().min(1).max(200) }),
          response: { 200: z.object({ csrfToken: z.string() }) },
        },
      },
      async (req, reply) => {
        const rows = await db.execute<{
          user_id: string;
          tenant_id: string;
          password_hash: string | null;
          active: boolean;
        }>(sql`select user_id, tenant_id, password_hash, active from auth_find_login(${req.body.email})`);
        // Same error for unknown user, wrong password, inactive or ambiguous email (no user enumeration).
        const u = rows.length === 1 ? rows[0] : undefined;
        const ok = u?.active && u.password_hash && (await verify(u.password_hash, req.body.password));
        if (!u || !ok) throw new HttpError(401, "invalid_credentials");
        const s = await createSession(db, u.user_id, u.tenant_id);
        setSessionCookie(reply, s.raw);
        return { csrfToken: s.csrf };
      },
    );
  }

  app.post("/auth/logout", async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw && req.auth) await deleteSession(db, raw, req.auth.tenantId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  if (config.entraEnabled) {
    let cached: oidc.Configuration | undefined;
    const oidcConfig = async () => {
      cached ??= await oidc.discovery(
        new URL(`https://login.microsoftonline.com/${config.ENTRA_TENANT_ID}/v2.0`),
        config.ENTRA_CLIENT_ID,
        config.ENTRA_CLIENT_SECRET,
      );
      return cached;
    };

    app.get("/auth/entra/login", { config: { public: true } }, async (_req, reply) => {
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const url = oidc.buildAuthorizationUrl(await oidcConfig(), {
        redirect_uri: config.ENTRA_REDIRECT_URI,
        scope: "openid profile email",
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
      });
      reply.setCookie(OIDC_COOKIE, JSON.stringify({ verifier, state }), {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/api/v1/auth/entra",
        maxAge: 600,
        signed: true,
      });
      return reply.redirect(url.href);
    });

    app.get("/auth/entra/callback", { config: { public: true } }, async (req, reply) => {
      const cookie = req.unsignCookie(req.cookies[OIDC_COOKIE] ?? "");
      if (!cookie.valid || !cookie.value) throw new HttpError(400, "oidc_state_missing");
      const { verifier, state } = JSON.parse(cookie.value) as { verifier: string; state: string };
      const currentUrl = new URL(req.url, config.ENTRA_REDIRECT_URI);
      const tokens = await oidc.authorizationCodeGrant(await oidcConfig(), currentUrl, {
        pkceCodeVerifier: verifier,
        expectedState: state,
      });
      const claims = tokens.claims();
      const oid = typeof claims?.oid === "string" ? claims.oid : undefined;
      if (!oid) throw new HttpError(401, "oidc_no_oid");
      const rows = await db.execute<{ user_id: string; tenant_id: string; active: boolean }>(
        sql`select user_id, tenant_id, active from auth_find_entra(${oid})`,
      );
      let user = rows[0];
      // First login: link by email within an existing tenant user (JIT creation of new users is M1, see OQ-10).
      if (!user && typeof claims?.email === "string") {
        const byEmail = await db.execute<{ user_id: string; tenant_id: string; active: boolean }>(
          sql`select user_id, tenant_id, active from auth_find_login(${claims.email})`,
        );
        if (byEmail.length === 1 && byEmail[0]) {
          user = byEmail[0];
          const { user_id, tenant_id } = user;
          await withTenant(db, tenant_id, (tx) =>
            tx.update(schema.users).set({ entraObjectId: oid }).where(eq(schema.users.id, user_id)),
          );
        }
      }
      if (!user?.active) throw new HttpError(403, "user_not_provisioned");
      const s = await createSession(db, user.user_id, user.tenant_id);
      setSessionCookie(reply, s.raw);
      reply.clearCookie(OIDC_COOKIE, { path: "/api/v1/auth/entra" });
      return reply.redirect(config.WEB_ORIGIN);
    });
  }
};
