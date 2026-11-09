/**
 * Data import routes (D-024) — GRASP Controller: checks the role and delegates to `services/data-import.ts`.
 * Customers and projects: Admin or Finance. Employees: Admin.
 *
 *   POST /import/:kind/preview   dry run: create/update per row with errors (nothing is written)
 *   POST /import/:kind/commit    apply all rows in one transaction (refused if any row has errors)
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireCapability } from "../auth/plugin.ts";
import { commitImport, previewImport } from "../services/data-import.ts";

const params = z.object({ kind: z.enum(["customers", "projects", "employees"]) });
const body = z.object({ csv: z.string().min(1).max(2_000_000) });

/** Registers the import endpoints under /api/v1. */
export const dataImportRoutes: FastifyPluginAsyncZod = async (app) => {
  const capability = (kind: string) => (kind === "employees" ? "people.import" : "data.import");

  app.post("/import/:kind/preview", { schema: { params, body }, bodyLimit: 2_200_000 }, async (req) => {
    requireCapability(req, capability(req.params.kind));
    return req.withTenant((tx) => previewImport(tx, req.params.kind, req.body.csv));
  });

  app.post("/import/:kind/commit", { schema: { params, body }, bodyLimit: 2_200_000 }, async (req) => {
    const auth = requireCapability(req, capability(req.params.kind));
    return req.withTenant((tx) => commitImport(tx, auth, req.params.kind, req.body.csv));
  });
};
