/**
 * Reports and balances (docs/spec/reporting.md) — GRASP Pure Fabrication: report queries and CSV export.
 * CSV is made for Danish Excel: semicolon separator, decimal comma, UTF-8 with BOM, CRLF line endings.
 * Visibility follows `services/people.ts` (time entries) and `services/projects.ts` (projects).
 */
import { schema, type Tx } from "@arc-tid/db";
import {
  formatHours,
  formatMinor,
  hasRole,
  type LocalDate,
  MASKED_ABSENCE,
  todayCopenhagen,
} from "@arc-tid/domain";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { flexBalance, loadEmployee, vacationBalance } from "./calendar.ts";
import { AppError } from "./errors.ts";
import { reportIds, visibleUserIds } from "./people.ts";
import { projectSummaries, visibleProjectIds } from "./projects.ts";
import { tenantGoLive } from "./timesheet.ts";

/**
 * Builds a CSV document for Danish Excel. Values containing ; " or line breaks are quoted.
 * @example toCsv(["Navn", "Timer"], [["Laura", "7,50"]]) // "﻿Navn;Timer\r\nLaura;7,50\r\n"
 */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `﻿${[header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n")}\r\n`;
}

/** Basis points → "49,0" for CSV (empty when unknown). */
const pct = (bp: number | null) => (bp === null ? "" : (bp / 100).toFixed(1).replace(".", ","));

/** The signed-in employee's flex balance (hours, completed weeks) and vacation balance (days) for the holiday year. */
export async function myBalances(tx: Tx, auth: AuthContext) {
  const emp = await loadEmployee(tx, auth.userId);
  if (!emp) throw new AppError(404, "not_found");
  const today = todayCopenhagen();
  const vac = await vacationBalance(tx, emp, today);
  return {
    flex: (await flexBalance(tx, emp, today, await tenantGoLive(tx, auth.tenantId))) / 100,
    vacation: {
      holidayYear: vac.holidayYear,
      opening: vac.opening / 100,
      accrued: vac.accrued / 100,
      used: vac.used / 100,
      planned: vac.planned / 100,
      balance: vac.balance / 100,
    },
  };
}

/** Budget vs actual for every project the caller may see (same figures as the project list). */
export async function budgetActualRows(tx: Tx, auth: AuthContext) {
  return projectSummaries(tx, await visibleProjectIds(tx, auth));
}

/** Budget vs actual as a Danish CSV document. */
export function budgetActualCsv(rows: Awaited<ReturnType<typeof budgetActualRows>>): string {
  return toCsv(
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
}

/** Filters for the time-entry report. */
export interface TimeEntryFilter {
  from: LocalDate;
  to: LocalDate;
  userId?: string | undefined;
  projectId?: string | undefined;
}

/**
 * Time entries in a date range for the people the caller may see (self; reports for a line manager; everyone for
 * Finance/Admin/Management). Asking for a specific person outside that scope is refused with 403.
 */
export async function timeEntryRows(tx: Tx, auth: AuthContext, f: TimeEntryFilter) {
  const visible = await visibleUserIds(tx, auth);
  if (f.userId && visible !== "all" && !visible.includes(f.userId)) throw new AppError(403, "forbidden");
  const userFilter = f.userId ? [f.userId] : visible;
  const rows = await tx
    .select({
      date: schema.timeEntries.date,
      initials: schema.users.initials,
      employee: schema.users.fullName,
      projectNumber: schema.projects.number,
      projectName: schema.projects.name,
      wbs: schema.tasks.wbs,
      task: schema.tasks.name,
      userId: schema.timeEntries.userId,
      absence: schema.absenceCodes.nameDa,
      sensitive: schema.absenceCodes.sensitive,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
      status: schema.timeEntries.status,
      comment: schema.timeEntries.comment,
    })
    .from(schema.timeEntries)
    .innerJoin(schema.users, eq(schema.users.id, schema.timeEntries.userId))
    .leftJoin(schema.projects, eq(schema.projects.id, schema.timeEntries.projectId))
    .leftJoin(schema.tasks, eq(schema.tasks.id, schema.timeEntries.taskId))
    .leftJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
    .where(
      and(
        gte(schema.timeEntries.date, f.from),
        lte(schema.timeEntries.date, f.to),
        userFilter === "all"
          ? undefined
          : inArray(schema.timeEntries.userId, userFilter.length ? userFilter : [auth.userId]),
        f.projectId ? eq(schema.timeEntries.projectId, f.projectId) : undefined,
      ),
    )
    .orderBy(asc(schema.timeEntries.date), asc(schema.users.initials));
  // Sickness privacy (OQ-21, D-025): the reason behind a sensitive absence is shown only to the employee, their line
  // manager and Finance; Management/Admin see "Fravær" without the comment.
  const policy = policyOf(auth);
  const reports = hasRole(auth.roles, "line_manager")
    ? new Set(await reportIds(tx, auth.userId))
    : new Set<string>();
  return rows.map(({ userId, sensitive, ...r }) => {
    const relation = userId === auth.userId ? "self" : reports.has(userId) ? "line_manager" : "other";
    return sensitive && !policy.seesAbsenceReason(relation)
      ? { ...r, absence: MASKED_ABSENCE.nameDa, comment: null }
      : r;
  });
}

/** Time entries as a Danish CSV document. */
export function timeEntryCsv(rows: Awaited<ReturnType<typeof timeEntryRows>>): string {
  return toCsv(
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
    rows.map((r) => [
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
}
