/**
 * Administration (brief §4.15): norm-time patterns, holiday calendars, absence codes, employee settings.
 * Admin edits everything; finance may edit rates. Every change is audited.
 */
import { schema, writeAudit } from "@arc-tid/db";
import { danishPublicHolidays, defaultCompanyDays, kr } from "@arc-tid/domain";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, policyOf, requireCapability } from "../auth/plugin.ts";
import { AppError } from "../services/errors.ts";
import { approvalMode } from "../services/project-approval.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hoursPerDay = z.number().min(0).max(24).multipleOf(0.25);

/** Registers the administration endpoints (settings, norm patterns, holidays, absence codes, employee settings). */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Everything the settings screens need in one call. */
  app.get(
    "/admin/settings",
    { schema: { querystring: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) } },
    async (req) => {
      requireCapability(req, "settings.read");
      const year = req.query.year ?? new Date().getFullYear();
      return req.withTenant(async (tx) => ({
        year,
        normPatterns: await tx.select().from(schema.normPatterns).orderBy(asc(schema.normPatterns.name)),
        calendars: await tx.select().from(schema.holidayCalendars).orderBy(asc(schema.holidayCalendars.name)),
        holidays: await tx
          .select()
          .from(schema.holidays)
          .where(and(gte(schema.holidays.date, `${year}-01-01`), lte(schema.holidays.date, `${year}-12-31`)))
          .orderBy(asc(schema.holidays.date)),
        absenceCodes: await tx.select().from(schema.absenceCodes).orderBy(asc(schema.absenceCodes.code)),
        priceGroups: await tx.select().from(schema.priceGroups).orderBy(asc(schema.priceGroups.sort)),
        approvalMode: await approvalMode(tx, req.auth?.tenantId ?? ""),
      }));
    },
  );

  /** Sets how weeks are approved: none | line_manager | pm_then_line_manager (Admin only, audited). */
  app.patch(
    "/admin/approval-mode",
    { schema: { body: z.object({ mode: z.enum(["none", "line_manager", "pm_then_line_manager"]) }) } },
    async (req) => {
      requireCapability(req, "settings.manage");
      const auth = req.auth as AuthContext;
      return req.withTenant(async (tx) => {
        const before = await approvalMode(tx, auth.tenantId);
        await tx
          .update(schema.tenants)
          .set({ approvalMode: req.body.mode, updatedAt: new Date() })
          .where(eq(schema.tenants.id, auth.tenantId));
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "tenant",
          entityId: auth.tenantId,
          action: "approval_mode",
          userId: auth.userId,
          before: { mode: before },
          after: { mode: req.body.mode },
        });
        return { mode: req.body.mode };
      });
    },
  );

  /* ───────── norm patterns ───────── */

  app.post(
    "/admin/norm-patterns",
    {
      schema: {
        body: z.object({ name: z.string().trim().min(1).max(100), days: z.array(hoursPerDay).length(7) }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "settings.manage");
      return req.withTenant(async (tx) => {
        const [row] = await tx
          .insert(schema.normPatterns)
          .values({
            tenantId: auth.tenantId,
            name: req.body.name,
            cycleWeeks: 1,
            days: req.body.days.map((h) => Math.round(h * 100)),
          })
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "norm_pattern",
          entityId: row?.id ?? "",
          action: "create",
          userId: auth.userId,
          after: row,
        });
        return row;
      });
    },
  );

  /* ───────── holidays ───────── */

  /** Fills a year with the Danish public holidays and the company's default extra days (D-013). Idempotent. */
  app.post(
    "/admin/holiday-calendars/:id/generate",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ year: z.number().int().min(2000).max(2100) }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "settings.manage");
      const { year } = req.body;
      return req.withTenant(async (tx) => {
        const rows = [
          ...danishPublicHolidays(year).map((h) => ({ date: h.date, name: h.nameDa, kind: "full" as const })),
          ...defaultCompanyDays(year).map((h) => ({ date: h.date, name: h.nameDa, kind: h.kind })),
        ];
        for (const r of rows) {
          await tx
            .insert(schema.holidays)
            .values({ tenantId: auth.tenantId, calendarId: req.params.id, ...r })
            .onConflictDoNothing();
        }
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "holiday_calendar",
          entityId: req.params.id,
          action: "generate",
          userId: auth.userId,
          after: { year },
        });
        return { added: rows.length };
      });
    },
  );

  app.post(
    "/admin/holidays",
    {
      schema: {
        body: z.object({
          calendarId: z.string().uuid(),
          date: isoDate,
          name: z.string().trim().min(1).max(100),
          kind: z.enum(["full", "half", "hours"]),
          hours: hoursPerDay.optional(),
        }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "settings.manage");
      return req.withTenant(async (tx) => {
        const [row] = await tx
          .insert(schema.holidays)
          .values({
            tenantId: auth.tenantId,
            ...req.body,
            hours: req.body.kind === "hours" ? (req.body.hours ?? 0) : null,
          })
          .onConflictDoUpdate({
            target: [schema.holidays.calendarId, schema.holidays.date],
            set: { name: req.body.name, kind: req.body.kind },
          })
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "holiday",
          entityId: row?.id ?? "",
          action: "upsert",
          userId: auth.userId,
          after: row,
        });
        return row;
      });
    },
  );

  app.delete(
    "/admin/holidays/:id",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const auth = requireCapability(req, "settings.manage");
      return req.withTenant(async (tx) => {
        const [before] = await tx
          .delete(schema.holidays)
          .where(eq(schema.holidays.id, req.params.id))
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "holiday",
          entityId: req.params.id,
          action: "delete",
          userId: auth.userId,
          before,
        });
        return { ok: true };
      });
    },
  );

  /* ───────── absence codes ───────── */

  app.patch(
    "/admin/absence-codes/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          nameDa: z.string().trim().min(1).max(100).optional(),
          active: z.boolean().optional(),
          approvalRequired: z.boolean().optional(),
          countsTowardNorm: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "settings.manage");
      return req.withTenant(async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.absenceCodes)
          .where(eq(schema.absenceCodes.id, req.params.id));
        if (!before) throw new AppError(404, "not_found");
        const [after] = await tx
          .update(schema.absenceCodes)
          .set(req.body)
          .where(eq(schema.absenceCodes.id, before.id))
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "absence_code",
          entityId: before.id,
          action: "update",
          userId: auth.userId,
          before,
          after,
        });
        return after;
      });
    },
  );

  /* ───────── employee settings ───────── */

  app.get(
    "/admin/employees/:id",
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      requireCapability(req, "settings.read");
      return req.withTenant(async (tx) => {
        const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, req.params.id));
        if (!u) throw new AppError(404, "not_found");
        const norms = await tx
          .select({
            id: schema.employeeNorms.id,
            validFrom: schema.employeeNorms.validFrom,
            patternId: schema.normPatterns.id,
            patternName: schema.normPatterns.name,
          })
          .from(schema.employeeNorms)
          .innerJoin(schema.normPatterns, eq(schema.normPatterns.id, schema.employeeNorms.normPatternId))
          .where(eq(schema.employeeNorms.userId, u.id))
          .orderBy(desc(schema.employeeNorms.validFrom));
        return {
          id: u.id,
          fullName: u.fullName,
          initials: u.initials,
          employmentStart: u.employmentStart,
          employmentEnd: u.employmentEnd,
          priceGroupId: u.priceGroupId,
          salesRate: u.salesRate,
          costRate: u.costRate,
          flexOpening: u.flexOpening,
          vacationOpening: u.vacationOpening,
          payrollNumber: u.payrollNumber,
          active: u.active,
          canCreateProjects:
            (
              await tx
                .select()
                .from(schema.userRights)
                .where(
                  and(eq(schema.userRights.userId, u.id), eq(schema.userRights.right, "create_projects")),
                )
            ).length > 0,
          norms,
        };
      });
    },
  );

  app.patch(
    "/admin/employees/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          priceGroupId: z.string().uuid().nullable().optional(),
          /** kr */
          salesRate: z.number().min(0).max(100_000).optional(),
          /** kr */
          costRate: z.number().min(0).max(100_000).optional(),
          employmentEnd: isoDate.nullable().optional(),
          flexOpening: z.number().min(-999).max(999).multipleOf(0.25).optional(),
          vacationOpening: z.number().min(-99).max(99).optional(),
          /** employee number in the payroll system; empty string clears it */
          payrollNumber: z.string().trim().max(20).optional(),
          /** false = deactivated: cannot sign in, sessions revoked at once (spec R8); history stays */
          active: z.boolean().optional(),
          /** extra right for project managers to create projects (D-025) */
          canCreateProjects: z.boolean().optional(),
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      const b = req.body;
      // Finance may change rates and payroll numbers (finance settings); everything else is Admin only.
      const financeFieldsOnly = Object.keys(b).every(
        (k) => k === "salesRate" || k === "costRate" || k === "payrollNumber",
      );
      const policy = policyOf(auth);
      if (!policy.can("settings.manage") && !(financeFieldsOnly && policy.can("settings.read")))
        throw new AppError(403, "forbidden");
      return req.withTenant(async (tx) => {
        const [before] = await tx.select().from(schema.users).where(eq(schema.users.id, req.params.id));
        if (!before) throw new AppError(404, "not_found");
        const [after] = await tx
          .update(schema.users)
          .set({
            ...(b.priceGroupId !== undefined ? { priceGroupId: b.priceGroupId } : {}),
            ...(b.salesRate !== undefined ? { salesRate: kr(b.salesRate) } : {}),
            ...(b.costRate !== undefined ? { costRate: kr(b.costRate) } : {}),
            ...(b.employmentEnd !== undefined ? { employmentEnd: b.employmentEnd } : {}),
            ...(b.flexOpening !== undefined ? { flexOpening: b.flexOpening } : {}),
            ...(b.vacationOpening !== undefined ? { vacationOpening: b.vacationOpening } : {}),
            ...(b.payrollNumber !== undefined ? { payrollNumber: b.payrollNumber || null } : {}),
            ...(b.active !== undefined ? { active: b.active } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, before.id))
          .returning();
        if (b.active === false) {
          // Deactivation revokes access immediately (spec administration.md R8).
          await tx.delete(schema.sessions).where(eq(schema.sessions.userId, before.id));
          await tx.delete(schema.graphTokens).where(eq(schema.graphTokens.userId, before.id));
        }
        if (b.canCreateProjects !== undefined) {
          await tx
            .delete(schema.userRights)
            .where(
              and(eq(schema.userRights.userId, before.id), eq(schema.userRights.right, "create_projects")),
            );
          if (b.canCreateProjects)
            await tx
              .insert(schema.userRights)
              .values({ tenantId: auth.tenantId, userId: before.id, right: "create_projects" });
        }
        const pick = (u: typeof before | undefined) =>
          u && {
            priceGroupId: u.priceGroupId,
            salesRate: u.salesRate,
            costRate: u.costRate,
            employmentEnd: u.employmentEnd,
            flexOpening: u.flexOpening,
            vacationOpening: u.vacationOpening,
            payrollNumber: u.payrollNumber,
            active: u.active,
          };
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "employee",
          entityId: before.id,
          action: "update",
          userId: auth.userId,
          before: pick(before),
          after: {
            ...pick(after),
            ...(b.canCreateProjects !== undefined ? { canCreateProjects: b.canCreateProjects } : {}),
          },
        });
        return { ok: true };
      });
    },
  );

  /** New norm assignment from a date (back- or forward-dated). One assignment per date. */
  app.post(
    "/admin/employees/:id/norms",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ normPatternId: z.string().uuid(), validFrom: isoDate }),
      },
    },
    async (req) => {
      const auth = requireCapability(req, "settings.manage");
      return req.withTenant(async (tx) => {
        const [row] = await tx
          .insert(schema.employeeNorms)
          .values({ tenantId: auth.tenantId, userId: req.params.id, ...req.body })
          .onConflictDoUpdate({
            target: [schema.employeeNorms.userId, schema.employeeNorms.validFrom],
            set: { normPatternId: req.body.normPatternId },
          })
          .returning();
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "employee_norm",
          entityId: row?.id ?? "",
          action: "upsert",
          userId: auth.userId,
          after: row,
        });
        return row;
      });
    },
  );
};
