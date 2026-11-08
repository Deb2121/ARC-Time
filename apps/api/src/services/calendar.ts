/**
 * Loads an employee's norm context and computes flex and vacation balances from the database.
 * All rules come from @arc-tid/domain; this file only gathers the inputs.
 */
import { schema, type Tx } from "@arc-tid/db";
import {
  accruedDays,
  addDays,
  type CentiHours,
  dailyNorm,
  fromDecimal,
  type HolidayKind,
  holidayYearOf,
  type LocalDate,
  type NormContext,
  type SummaryEntry,
  startOfIsoWeek,
  summariseWeek,
} from "@arc-tid/domain";
import { and, eq, gte, lte } from "drizzle-orm";

export interface Employee {
  id: string;
  employmentStart: string;
  employmentEnd: string | null;
  holidayCalendarId: string | null;
  flexOpening: number;
  vacationOpening: number;
  costRate: number;
  salesRate: number;
  managerId: string | null;
}

export async function loadEmployee(tx: Tx, userId: string): Promise<Employee | undefined> {
  const [u] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
  return u;
}

export async function normContext(tx: Tx, emp: Employee): Promise<NormContext> {
  const assignments = await tx
    .select({
      validFrom: schema.employeeNorms.validFrom,
      cycleAnchor: schema.employeeNorms.cycleAnchor,
      days: schema.normPatterns.days,
      cycleWeeks: schema.normPatterns.cycleWeeks,
    })
    .from(schema.employeeNorms)
    .innerJoin(schema.normPatterns, eq(schema.normPatterns.id, schema.employeeNorms.normPatternId))
    .where(eq(schema.employeeNorms.userId, emp.id));
  const holidays = new Map<LocalDate, HolidayKind>();
  if (emp.holidayCalendarId) {
    const rows = await tx
      .select()
      .from(schema.holidays)
      .where(eq(schema.holidays.calendarId, emp.holidayCalendarId));
    for (const h of rows) {
      holidays.set(
        h.date,
        h.kind === "hours" ? { kind: "hours", hours: fromDecimal(h.hours ?? 0) } : { kind: h.kind },
      );
    }
  }
  return {
    assignments: assignments.map((a) => ({
      validFrom: a.validFrom,
      cycleAnchor: a.cycleAnchor ?? undefined,
      pattern: { cycleWeeks: a.cycleWeeks === 2 ? 2 : 1, days: a.days },
    })),
    holidays,
    employment: { start: emp.employmentStart, end: emp.employmentEnd ?? undefined },
  };
}

/** Entries of one employee in a date range, in the shape the domain summary needs. */
export async function summaryEntries(
  tx: Tx,
  userId: string,
  from: LocalDate,
  to: LocalDate,
): Promise<SummaryEntry[]> {
  const rows = await tx
    .select({
      date: schema.timeEntries.date,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
      absenceCodeId: schema.timeEntries.absenceCodeId,
      countsTowardNorm: schema.absenceCodes.countsTowardNorm,
    })
    .from(schema.timeEntries)
    .leftJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
    .where(
      and(
        eq(schema.timeEntries.userId, userId),
        gte(schema.timeEntries.date, from),
        lte(schema.timeEntries.date, to),
      ),
    );
  return rows.map((r) => ({
    date: r.date,
    hours: fromDecimal(r.hours),
    kind: r.absenceCodeId ? "absence" : "work",
    billable: r.billable,
    countsTowardNorm: r.countsTowardNorm ?? false,
  }));
}

/**
 * Flex balance (docs/spec/absence-flex.md): opening balance at go-live + Σ weekly flex for completed weeks
 * (setting "computed up to last Sunday", D-013) — the current week is shown separately as "this week".
 */
export async function flexBalance(
  tx: Tx,
  emp: Employee,
  today: LocalDate,
  goLive: LocalDate,
): Promise<CentiHours> {
  const ctx = await normContext(tx, emp);
  const from = startOfIsoWeek(goLive > emp.employmentStart ? goLive : emp.employmentStart);
  const currentMonday = startOfIsoWeek(today);
  if (from >= currentMonday) return fromDecimal(emp.flexOpening);
  const entries = await summaryEntries(tx, emp.id, from, addDays(currentMonday, -1));
  let balance = fromDecimal(emp.flexOpening);
  for (let monday = from; monday < currentMonday; monday = addDays(monday, 7)) {
    const sunday = addDays(monday, 6);
    const week = entries.filter((e) => e.date >= monday && e.date <= sunday);
    balance += summariseWeek(monday, week, (d) => dailyNorm(d, ctx)).flex;
  }
  return balance;
}

export interface VacationBalance {
  holidayYear: number;
  /** centi-days */
  opening: number;
  accrued: number;
  used: number;
  planned: number;
  balance: number;
}

/** Vacation (samtidighedsferie, D-013): opening + accrued − used in the current holiday year, in centi-days. */
export async function vacationBalance(tx: Tx, emp: Employee, today: LocalDate): Promise<VacationBalance> {
  const hy = holidayYearOf(today);
  const yearStart = `${hy}-09-01`;
  const yearEnd = `${hy + 1}-08-31`;
  const ctx = await normContext(tx, emp);
  const rows = await tx
    .select({ date: schema.timeEntries.date, hours: schema.timeEntries.hours })
    .from(schema.timeEntries)
    .innerJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
    .where(
      and(
        eq(schema.timeEntries.userId, emp.id),
        eq(schema.absenceCodes.code, "FERIE"),
        gte(schema.timeEntries.date, yearStart),
        lte(schema.timeEntries.date, yearEnd),
      ),
    );
  let used = 0;
  let planned = 0;
  for (const r of rows) {
    const norm = dailyNorm(r.date, ctx);
    const days = norm > 0 ? Math.round((fromDecimal(r.hours) * 100) / norm) : 0;
    if (r.date <= today) used += days;
    else planned += days;
  }
  const opening = Math.round(emp.vacationOpening * 100);
  const accrued = accruedDays(hy, today, emp.employmentStart, emp.employmentEnd ?? undefined);
  return { holidayYear: hy, opening, accrued, used, planned, balance: opening + accrued - used - planned };
}
