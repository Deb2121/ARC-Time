/**
 * Administration (brief §4.15): norm-time patterns, holiday calendars, absence codes, employee settings.
 * Admin edits everything; finance may edit rates. Every change is audited.
 */
import { schema, writeAudit } from "@arc-tid/db";
import { danishPublicHolidays, defaultCompanyDays, hasRole, kr } from "@arc-tid/domain";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { type AuthContext, requireRole } from "../auth/plugin.ts";
import { AppError } from "../services/errors.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hoursPerDay = z.number().min(0).max(24).multipleOf(0.25);

/** Registers the administration endpoints (settings, norm patterns, holidays, absence codes, employee settings). */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Everything the settings screens need in one call. */
  app.get(
    "/admin/settings",
    { schema: { querystring: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) } },
    async (req) => {
      requireRole(req, "admin", "finance");
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
      }));
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
      const auth = requireRole(req, "admin");
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
      const auth = requireRole(req, "admin");
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
      const auth = requireRole(req, "admin");
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
      const auth = requireRole(req, "admin");
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
      const auth = requireRole(req, "admin");
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
      requireRole(req, "admin", "finance");
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
        }),
      },
    },
    async (req) => {
      const auth = req.auth as AuthContext;
      const b = req.body;
      // Finance may change rates; everything else is admin only.
      const ratesOnly = Object.keys(b).every((k) => k === "salesRate" || k === "costRate");
      if (!hasRole(auth.roles, "admin") && !(ratesOnly && hasRole(auth.roles, "finance")))
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
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, before.id))
          .returning();
        const pick = (u: typeof before | undefined) =>
          u && {
            priceGroupId: u.priceGroupId,
            salesRate: u.salesRate,
            costRate: u.costRate,
            employmentEnd: u.employmentEnd,
            flexOpening: u.flexOpening,
            vacationOpening: u.vacationOpening,
          };
        await writeAudit(tx, {
          tenantId: auth.tenantId,
          entity: "employee",
          entityId: before.id,
          action: "update",
          userId: auth.userId,
          before: pick(before),
          after: pick(after),
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
      const auth = requireRole(req, "admin");
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
