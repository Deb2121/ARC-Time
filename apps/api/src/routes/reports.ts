/**
 * Balances and MVP reports with CSV export (docs/spec/reporting.md).
 * CSV for Danish Excel: semicolon separator, decimal comma, UTF-8 with BOM.
 */
import { schema } from "@arc-tid/db";
import { formatHours, formatMinor, todayCopenhagen } from "@arc-tid/domain";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthContext } from "../auth/plugin.ts";
import { HttpError } from "../auth/plugin.ts";
import { flexBalance, loadEmployee, vacationBalance } from "../services/calendar.ts";
import { visibleUserIds } from "../services/people.ts";
import { projectSummaries, visibleProjectIds } from "../services/projects.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `﻿${[header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n")}\r\n`;
}

const pct = (bp: number | null) => (bp === null ? "" : (bp / 100).toFixed(1).replace(".", ","));

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/me/balances", async (req) => {
    const auth = req.auth as AuthContext;
    return req.withTenant(async (tx) => {
      const emp = await loadEmployee(tx, auth.userId);
      if (!emp) throw new HttpError(404, "not_found");
      const [t] = await tx
        .select({ goLive: schema.tenants.goLiveDate })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, auth.tenantId));
      const today = todayCopenhagen();
      const vac = await vacationBalance(tx, emp, today);
      return {
        flex: (await flexBalance(tx, emp, today, t?.goLive ?? today)) / 100,
        vacation: {
          holidayYear: vac.holidayYear,
          opening: vac.opening / 100,
          accrued: vac.accrued / 100,
          used: vac.used / 100,
          planned: vac.planned / 100,
          balance: vac.balance / 100,
        },
      };
    });
  });

  app.get(
    "/reports/budget-actual",
    { schema: { querystring: z.object({ format: z.enum(["json", "csv"]).default("json") }) } },
    async (req, reply) => {
      const auth = req.auth as AuthContext;
      const rows = await req.withTenant(async (tx) =>
        projectSummaries(tx, await visibleProjectIds(tx, auth)),
      );
      if (req.query.format === "json") return rows;
      const csv = toCsv(
        [
          "Projekt",
          "Navn",
          "Kunde",
          "Projektleder",
          "Budget timer",
          "Forbrugte timer",
          "Forbrug %",
          "Budget kr",
          "Værdi kr",
          "Omkostning kr",
          "DB kr",
          "DB-grad %",
          "Status",
        ],
        rows.map((r) => [
          r.number,
          r.name,
          r.customerName,
          r.managerInitials,
          formatHours(r.budgetHours),
          formatHours(r.usedHours),
          pct(r.hoursConsumptionBp),
          formatMinor(r.budgetAmount),
          formatMinor(r.usedValue),
          formatMinor(r.usedCost),
          formatMinor(r.contributionMargin),
          pct(r.marginBp),
          r.health,
        ]),
      );
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="budget-vs-forbrug.csv"')
        .send(csv);
    },
  );

  app.get(
    "/reports/time-entries",
    {
      schema: {
        querystring: z.object({
          from: isoDate,
          to: isoDate,
          userId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
          format: z.enum(["json", "csv"]).default("json"),
        }),
      },
    },
    async (req, reply) => {
      const auth = req.auth as AuthContext;
      const q = req.query;
      const rows = await req.withTenant(async (tx) => {
        const visible = await visibleUserIds(tx, auth);
        if (q.userId && visible !== "all" && !visible.includes(q.userId))
          throw new HttpError(403, "forbidden");
        const userFilter = q.userId ? [q.userId] : visible;
        return tx
          .select({
            date: schema.timeEntries.date,
            initials: schema.users.initials,
            employee: schema.users.fullName,
            projectNumber: schema.projects.number,
            projectName: schema.projects.name,
            wbs: schema.tasks.wbs,
            task: schema.tasks.name,
            absence: schema.absenceCodes.nameDa,
            sensitive: schema.absenceCodes.sensitive,
            hours: schema.timeEntries.hours,
            billable: schema.timeEntries.billable,
            status: schema.timeEntries.status,
            comment: schema.timeEntries.comment,
            userId: schema.timeEntries.userId,
          })
          .from(schema.timeEntries)
          .innerJoin(schema.users, eq(schema.users.id, schema.timeEntries.userId))
          .leftJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
          .leftJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
          .leftJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
          .where(
            and(
              gte(schema.timeEntries.date, q.from),
              lte(schema.timeEntries.date, q.to),
              userFilter === "all"
                ? undefined
                : inArray(schema.timeEntries.userId, userFilter.length ? userFilter : [auth.userId]),
              q.projectId ? eq(schema.timeEntries.projectId, q.projectId) : undefined,
            ),
          )
          .orderBy(asc(schema.timeEntries.date), asc(schema.users.initials));
      });
      // Sickness privacy (D-013): sensitive absence reasons are shown as "Fravær" except to self/finance/admin/manager.
      // Every caller here already passed the visibility check (self, manager, finance/admin/management), so reasons stay.
      const out = rows.map(({ sensitive: _s, userId: _u, ...r }) => r);
      if (q.format === "json") return out;
      const csv = toCsv(
        [
          "Dato",
          "Initialer",
          "Medarbejder",
          "Projekt",
          "Projektnavn",
          "WBS",
          "Opgave/fravær",
          "Timer",
          "Fakturerbar",
          "Status",
          "Kommentar",
        ],
        out.map((r) => [
          r.date,
          r.initials,
          r.employee,
          r.projectNumber,
          r.projectName,
          r.wbs,
          r.task ?? r.absence,
          formatHours(Math.round(r.hours * 100)),
          r.billable ? "Ja" : "Nej",
          r.status,
          r.comment,
        ]),
      );
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="timer-${q.from}-${q.to}.csv"`)
        .send(csv);
    },
  );
};
