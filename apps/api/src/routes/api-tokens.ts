/**
 * API token routes (D-028) — GRASP Controller: Finance/Management/Admin manage their own read-only analytics tokens.
 *
 *   GET    /api-tokens        own tokens (name, prefix, created, expires, last used, revoked)
 *   POST   /api-tokens        create a token; the raw token is in this response only
 *   DELETE /api-tokens/:id    revoke
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireCapability } from "../auth/plugin.ts";
import { createToken, listTokens, revokeToken } from "../services/api-tokens.ts";

/** Registers the API token endpoints under /api/v1. */
export const apiTokenRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/api-tokens", async (req) => {
    const auth = requireCapability(req, "analytics.token");
    return req.withTenant((tx) => listTokens(tx, auth));
  });

  app.post(
    "/api-tokens",
    { schema: { body: z.object({ name: z.string().trim().min(2).max(80) }) } },
    async (req) => {
      const auth = requireCapability(req, "analytics.token");
      return req.withTenant((tx) => createToken(tx, auth, req.body.name));
    },
  );

  app.delete("/api-tokens/:id", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const auth = requireCapability(req, "analytics.token");
    return req.withTenant((tx) => revokeToken(tx, auth, req.params.id));
  });
};
