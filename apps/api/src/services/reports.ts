/**
 * Reports and balances (docs/spec/reporting.md) — GRASP Pure Fabrication: report queries and their export tables.
 * Excel (.xlsx) and CSV files are made from those tables by `services/export.ts` (D-033).
 * Visibility follows `services/people.ts` (time entries) and `services/projects.ts` (projects).
 */
import { schema, type Tx } from "@arc-tid/db";
import { hasRole, type LocalDate, MASKED_ABSENCE, todayCopenhagen } from "@arc-tid/domain";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { type AuthContext, policyOf } from "../auth/plugin.ts";
import { flexBalance, loadEmployee } from "./calendar.ts";
import { AppError } from "./errors.ts";
import { type ExportTable, entryStatusDa } from "./export.ts";
import { leaveAccounts } from "./leave.ts";
import { reportIds, visibleUserIds } from "./people.ts";
import { projectSummaries, visibleProjectIds } from "./projects.ts";
import { tenantGoLive } from "./timesheet.ts";

/**
 * The signed-in employee's flex balance (hours, completed weeks) and leave balances (days) — the same figures as the
 * leave accounts page (D-037): ferie always, feriefridage when the employee earns them.
 */
export async function myBalances(tx: Tx, auth: AuthContext) {
  const emp = await loadEmployee(tx, auth.userId);
  if (!emp) throw new AppError(404, "not_found");
  const today = todayCopenhagen();
  const leave = await leaveAccounts(tx, auth, auth.userId, today);
  const days = (a: (typeof leave.accounts)[number]) => ({
    earned: a.earned / 100,
    used: a.used / 100,
    pending: a.pending / 100,
    balance: a.balance / 100,
  });
  const [ferie, fri] = leave.accounts;
  return {
    flex: (await flexBalance(tx, emp, today, await tenantGoLive(tx, auth.tenantId))) / 100,
    vacation: ferie ? days(ferie) : null,
    extraHoliday: fri && (fri.perMonth > 0 || fri.balance !== 0) ? days(fri) : null,
  };
}

/** Budget vs actual for every project the caller may see (same figures as the project list). */
export async function budgetActualRows(tx: Tx, auth: AuthContext) {
  return projectSummaries(tx, await visibleProjectIds(tx, auth));
}

/** Budget vs actual as an export table (Excel or CSV): one row per project, totals for hours and amounts. */
export function budgetActualExport(
  rows: Awaited<ReturnType<typeof budgetActualRows>>,
  today: LocalDate = todayCopenhagen(),
): ExportTable<(typeof rows)[number]> {
  const pctOf = (bp: number | null) => (bp === null ? null : bp / 100);
  return {
    sheet: "Budget og forbrug",
    file: `ARCtime_budget-og-forbrug_${today}`,
    rows,
    columns: [
      { header: "Projekt", kind: "text", value: (r) => r.number },
      { header: "Navn", kind: "text", value: (r) => r.name },
      { header: "Kunde", kind: "text", value: (r) => r.customerName },
      { header: "Projektleder", kind: "text", value: (r) => r.managerInitials },
      { header: "Budget timer", kind: "hours", value: (r) => r.budgetHours / 100, total: true },
      { header: "Forbrugte timer", kind: "hours", value: (r) => r.usedHours / 100, total: true },
      { header: "Forbrug %", kind: "percent", value: (r) => pctOf(r.hoursConsumptionBp) },
      { header: "Budget kr", kind: "money", value: (r) => r.budgetAmount / 100, total: true },
      { header: "Værdi kr", kind: "money", value: (r) => r.usedValue / 100, total: true },
      { header: "Omkostning kr", kind: "money", value: (r) => r.usedCost / 100, total: true },
      { header: "DB-grad %", kind: "percent", value: (r) => pctOf(r.marginBp) },
      { header: "Status", kind: "text", value: (r) => HEALTH_DA[r.health] ?? r.health },
    ],
  };
}

/** Budget status in plain Danish for exports (never the internal code). */
const HEALTH_DA: Record<string, string> = {
  ok: "På sporet",
  warning: "Tæt på budget",
  over: "Over budget",
  no_budget: "Intet budget",
};

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

/** "2026-09" when the period is exactly one calendar month, otherwise "2026-09-01_2026-10-15" (file names). */
export function periodLabel(from: LocalDate, to: LocalDate): string {
  const lastDay = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).getUTCDate();
  const wholeMonth =
    from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01") && Number(to.slice(8, 10)) === lastDay;
  return wholeMonth ? from.slice(0, 7) : `${from}_${to}`;
}

/** Time entries as an export table (Excel or CSV), with total hours. */
export function timeEntryExport(
  rows: Awaited<ReturnType<typeof timeEntryRows>>,
  period: { from: LocalDate; to: LocalDate },
): ExportTable<(typeof rows)[number]> {
  return {
    sheet: "Tidsregistreringer",
    file: `ARCtime_tidsregistreringer_${periodLabel(period.from, period.to)}`,
    rows,
    columns: [
      { header: "Dato", kind: "date", value: (r) => r.date },
      { header: "Initialer", kind: "text", value: (r) => r.initials },
      { header: "Medarbejder", kind: "text", value: (r) => r.employee },
      { header: "Projekt", kind: "text", value: (r) => r.projectNumber },
      { header: "Projektnavn", kind: "text", value: (r) => r.projectName },
      { header: "WBS", kind: "text", value: (r) => r.wbs },
      { header: "Opgave/fravær", kind: "text", value: (r) => r.task ?? r.absence },
      { header: "Timer", kind: "hours", value: (r) => r.hours, total: true },
      { header: "Fakturerbar", kind: "yesno", value: (r) => r.billable },
      { header: "Status", kind: "text", value: (r) => entryStatusDa(r.status) },
      { header: "Kommentar", kind: "comment", value: (r) => r.comment },
    ],
  };
}
