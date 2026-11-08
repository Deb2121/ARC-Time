/**
 * Payroll export routes (docs/spec/payroll.md, D-023) — GRASP Controller: Finance only (AC7); validate input and
 * delegate to `services/payroll.ts`. Salary-code setup is Finance or Admin.
 *
 *   GET   /payroll/periods                         pay periods (months) with status
 *   GET   /payroll/periods/:month                  preview: rows per employee, lines and warnings
 *   POST  /payroll/periods/:month/export           generate / regenerate the file
 *   POST  /payroll/periods/:month/lock             lock an exported month
 *   GET   /payroll/periods/:month/file.csv         download the generated CSV
 *   GET   /payroll/salary-codes                    salary codes + absence-code mapping
 *   PATCH /payroll/salary-codes/:id                edit provider code / include in export
 *   PUT   /payroll/absence-mapping                 map an absence code to a salary code (or none)
 */
import { schema, writeAudit } from "@arc-tid/db";
import { asc, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../auth/plugin.ts";
import { AppError } from "../services/errors.ts";
import {
  exportPayroll,
  lockPayPeriod,
  payPeriods,
  payrollFile,
  payrollPreview,
} from "../services/payroll.ts";

const month = z.string().regex(/^\d{4}-\d{2}-01$/, "first day of a month");
const monthParams = z.object({ month });

/** Registers the payroll endpoints under /api/v1. */
export const payrollRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/payroll/periods", async (req) => {
    const auth = requireRole(req, "finance");
    return req.withTenant((tx) => payPeriods(tx, auth));
  });

  app.get("/payroll/periods/:month", { schema: { params: monthParams } }, async (req) => {
    const auth = requireRole(req, "finance");
    return req.withTenant((tx) => payrollPreview(tx, auth, req.params.month));
  });

  app.post("/payroll/periods/:month/export", { schema: { params: monthParams } }, async (req) => {
    const auth = requireRole(req, "finance");
    return req.withTenant((tx) => exportPayroll(tx, auth, req.params.month));
  });

  app.post("/payroll/periods/:month/lock", { schema: { params: monthParams } }, async (req) => {
    const auth = requireRole(req, "finance");
    return req.withTenant((tx) => lockPayPeriod(tx, auth, req.params.month));
  });

  app.get("/payroll/periods/:month/file.csv", { schema: { params: monthParams } }, async (req, reply) => {
    requireRole(req, "finance");
    const f = await req.withTenant((tx) => payrollFile(tx, req.params.month));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${f.filename}"`)
      .send(f.csv);
  });

  app.get("/payroll/salary-codes", async (req) => {
    requireRole(req, "finance", "admin");
    return req.withTenant(async (tx) => ({
      codes: await tx.select().from(schema.salaryCodes).orderBy(asc(schema.salaryCodes.code)),
      absenceCodes: await tx
        .select({
          id: schema.absenceCodes.id,
          code: schema.absenceCodes.code,
          nameDa: schema.absenceCodes.nameDa,
          nameEn: schema.absenceCodes.nameEn,
          salaryCodeId: schema.absenceCodes.salaryCodeId,
        })
        .from(schema.absenceCodes)
        .orderBy(asc(schema.absenceCodes.code)),
    }));
  });

  app.patch(
    "/payroll/salary-codes/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          providerCode: z.string().trim().max(20).nullable().optional(),
          includeInExport: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const auth = requireRole(req, "finance", "admin");
      return req.withTenant(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.salaryCodes)
          .where(eq(schema.salaryCodes.id, req.params.id));
        if (!before) throw new AppError(404, "not_found");
        const [after] = await tx
          .update(schema.salaryCodes)
          .set(req.body)
          .where(eq(schema.salaryCodes.id, before.id))
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "salary_code",
          entityId: before.id,
          action: "update",
          userId: auth.userId,
          before: { providerCode: before.providerCode, includeInExport: before.includeInExport },
          after: req.body,
        });
        return after;
      });
    },
  );

  app.put(
    "/payroll/absence-mapping",
    {
      schema: {
        body: z.object({ absenceCodeId: z.string().uuid(), salaryCodeId: z.string().uuid().nullable() }),
      },
    },
    async (req) => {
      const auth = requireRole(req, "finance", "admin");
      return req.withTenant(async (tx) => {
        if (req.body.salaryCodeId) {
          const [c] = await tx
            .select()
            .from(schema.salaryCodes)
            .where(eq(schema.salaryCodes.id, req.body.salaryCodeId));
          if (c?.kind !== "absence") throw new AppError(400, "not_an_absence_code");
        }
        const [row] = await tx
          .update(schema.absenceCodes)
          .set({ salaryCodeId: req.body.salaryCodeId })
          .where(eq(schema.absenceCodes.id, req.body.absenceCodeId))
          .returning();
        if (!row) throw new AppError(404, "not_found");
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "absence_code",
          entityId: row.id,
          action: "salary_mapping",
          userId: auth.userId,
          after: { salaryCodeId: req.body.salaryCodeId },
        });
        return { ok: true };
      });
    },
  );
};
