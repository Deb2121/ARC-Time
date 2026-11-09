/**
 * Audit log and GDPR routes (docs/spec/administration.md, D-025/D-026) — GRASP Controller: check the capability,
 * validate input, delegate to `services/audit-log.ts` and `services/gdpr.ts`.
 *
 *   GET  /audit                          audit rows (filters, newest first, cursor `before`)
 *   GET  /audit/entities                 entity types the caller may filter on
 *   GET  /admin/employees/:id/gdpr-export  everything about one person as a JSON download (Admin)
 *   GET  /admin/employees/:id/erasure    what an erasure would keep/remove and what blocks it (Admin)
 *   POST /admin/employees/:id/erase      pseudonymise a former employee (Admin, reason required, irreversible)
 *   GET  /admin/retention                records past retention and former employees not yet erased (Admin)
 */
import { todayCopenhagen } from "@arc-tid/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireCapability } from "../auth/plugin.ts";
import { auditEntities, readAuditLog } from "../services/audit-log.ts";
import { erasePerson, erasurePreview, exportPersonalData, pastRetention } from "../services/gdpr.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParams = z.object({ id: z.string().uuid() });

/** Registers the audit and GDPR endpoints under /api/v1. */
export const governanceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/audit",
    {
      schema: {
        querystring: z.object({
          entity: z.string().max(60).optional(),
          action: z.string().max(60).optional(),
          userId: z.string().uuid().optional(),
          entityId: z.string().max(100).optional(),
          from: isoDate.optional(),
          to: isoDate.optional(),
          before: z.string().datetime({ offset: true }).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "audit.read");
      return req.withTenant((tx) => readAuditLog(tx, auth, req.query));
    },
  );

  app.get("/audit/entities", async (req) => {
    const auth = requireCapability(req, "audit.read");
    return req.withTenant((tx) => auditEntities(tx, auth));
  });

  app.get("/admin/employees/:id/gdpr-export", { schema: { params: idParams } }, async (req, reply) => {
    const auth = requireCapability(req, "gdpr.manage");
    const data = await req.withTenant((tx) => exportPersonalData(tx, auth, req.params.id));
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="persondata_${req.params.id.slice(0, 8)}.json"`)
      .send(JSON.stringify(data, null, 2));
  });

  app.get("/admin/employees/:id/erasure", { schema: { params: idParams } }, async (req) => {
    requireCapability(req, "gdpr.manage");
    return req.withTenant((tx) => erasurePreview(tx, req.params.id));
  });

  app.post(
    "/admin/employees/:id/erase",
    { schema: { params: idParams, body: z.object({ reason: z.string().trim().min(3).max(500) }) } },
    async (req) => {
      const auth = requireCapability(req, "gdpr.manage");
      return req.withTenant((tx) => erasePerson(tx, auth, req.params.id, req.body.reason));
    },
  );

  app.get("/admin/retention", async (req) => {
    requireCapability(req, "gdpr.manage");
    return req.withTenant((tx) => pastRetention(tx, todayCopenhagen()));
  });
};
