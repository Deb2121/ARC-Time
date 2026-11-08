/**
 * Payroll export (docs/spec/payroll.md, decision D-023) — GRASP Pure Fabrication: gathers approved absence, mileage
 * and personal expenses per employee × salary code × month, previews them with warnings, writes the generic CSV and
 * locks months. The rules themselves (days from hours, late deltas, CSV format) live in packages/domain/src/payroll.ts.
 *
 * Flow per month: open → exported (can be re-exported; the new file replaces the old, AC4) → locked (frozen).
 * Items that change in a locked month are delivered as late delta lines in the next export (R7, AC3).
 */
import { schema, type Tx, writeAudit } from "@arc-tid/db";
import {
  absenceDayFraction,
  addDays,
  dailyNorm,
  fromDecimal,
  type LocalDate,
  lastDayOfMonth,
  lateDeltas,
  lineKey,
  monthOf,
  type PayrollCsvRow,
  type PayrollLine,
  payrollCsv,
  type SalaryUnit,
  todayCopenhagen,
} from "@arc-tid/domain";
import { and, asc, eq, gte, inArray, isNotNull, lt, lte } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { loadEmployee, normContext } from "./calendar.ts";
import { AppError } from "./errors.ts";
import { tenantGoLive } from "./timesheet.ts";

const ELIGIBLE = ["approved", "invoiced"] as const;
type SalaryCode = typeof schema.salaryCodes.$inferSelect;

/** Creates monthly pay periods from the go-live month up to the current month (idempotent) and lists them. */
export async function payPeriods(tx: Tx, auth: AuthContext) {
  const first = monthOf(await tenantGoLive(tx, auth.tenantId));
  const current = monthOf(todayCopenhagen());
  const months: LocalDate[] = [];
  for (let m = first; m <= current; m = monthOf(addDays(lastDayOfMonth(m), 1))) months.push(m);
  if (months.length)
    await tx
      .insert(schema.payPeriods)
      .values(months.map((month) => ({ tenantId: auth.tenantId, month })))
      .onConflictDoNothing();
  return tx.select().from(schema.payPeriods).orderBy(asc(schema.payPeriods.month));
}

/** Loads one pay period by month or throws 404. */
async function loadPeriod(tx: Tx, month: LocalDate) {
  const [p] = await tx.select().from(schema.payPeriods).where(eq(schema.payPeriods.month, month));
  if (!p) throw new AppError(404, "not_found");
  return p;
}

/** Current payroll quantities for one month from approved items (all employees, mapped and included codes only). */
async function currentLines(tx: Tx, month: LocalDate, codes: SalaryCode[]): Promise<PayrollLine[]> {
  const end = lastDayOfMonth(month);
  const lines = new Map<string, PayrollLine>();
  const add = (userId: string, salaryCodeId: string, quantity: number, amount: number | null) => {
    const l: PayrollLine = { userId, salaryCodeId, month, quantity, amount, sourceCount: 1 };
    const prev = lines.get(lineKey(l));
    if (prev) {
      prev.quantity += quantity;
      prev.amount = amount === null ? prev.amount : (prev.amount ?? 0) + amount;
      prev.sourceCount++;
    } else lines.set(lineKey(l), l);
  };
  const included = new Map(codes.filter((c) => c.includeInExport).map((c) => [c.id, c]));

  // Absence → its salary code; days are hours ÷ that day's norm (R2).
  const absence = await tx
    .select({
      userId: schema.timeEntries.userId,
      date: schema.timeEntries.date,
      hours: schema.timeEntries.hours,
      codeId: schema.absenceCodes.salaryCodeId,
    })
    .from(schema.timeEntries)
    .innerJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
    .where(
      and(
        gte(schema.timeEntries.date, month),
        lte(schema.timeEntries.date, end),
        inArray(schema.timeEntries.status, [...ELIGIBLE]),
        isNotNull(schema.absenceCodes.salaryCodeId),
      ),
    );
  const norms = new Map<string, Awaited<ReturnType<typeof normContext>> | null>();
  for (const a of absence) {
    const code = a.codeId ? included.get(a.codeId) : undefined;
    if (!code) continue;
    const hours = fromDecimal(a.hours);
    if (code.unit === "days") {
      if (!norms.has(a.userId)) {
        const emp = await loadEmployee(tx, a.userId);
        norms.set(a.userId, emp ? await normContext(tx, emp) : null);
      }
      const ctx = norms.get(a.userId);
      add(a.userId, code.id, ctx ? absenceDayFraction(hours, dailyNorm(a.date, ctx)) : 0, null);
    } else add(a.userId, code.id, hours, null);
  }

  // Mileage (km + reimbursement) and personal expenses (amount incl. VAT) → the first included code of that kind.
  const mileage = codes.find((c) => c.kind === "mileage" && c.includeInExport);
  const expense = codes.find((c) => c.kind === "expense" && c.includeInExport);
  const claims = await tx
    .select({
      userId: schema.expenses.userId,
      kind: schema.expenses.kind,
      km: schema.expenses.km,
      gross: schema.expenses.grossAmount,
    })
    .from(schema.expenses)
    .where(
      and(
        gte(schema.expenses.date, month),
        lte(schema.expenses.date, end),
        inArray(schema.expenses.status, [...ELIGIBLE]),
      ),
    );
  for (const c of claims) {
    if (c.kind === "mileage" && mileage) add(c.userId, mileage.id, Math.round((c.km ?? 0) * 100), c.gross);
    if (c.kind === "expense" && expense) add(c.userId, expense.id, 100, c.gross);
  }
  return [...lines.values()].filter((l) => l.quantity !== 0 || (l.amount ?? 0) !== 0);
}

/** What locked runs already delivered for months before `month`, per employee × code × month. */
async function exportedBefore(tx: Tx, month: LocalDate): Promise<PayrollLine[]> {
  const rows = await tx
    .select({ line: schema.payrollLines })
    .from(schema.payrollLines)
    .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payrollLines.runId))
    .innerJoin(schema.payPeriods, eq(schema.payPeriods.id, schema.payrollRuns.payPeriodId))
    .where(and(eq(schema.payPeriods.status, "locked"), lt(schema.payrollLines.month, month)));
  const sum = new Map<string, PayrollLine>();
  for (const { line } of rows) {
    const l: PayrollLine = {
      userId: line.userId,
      salaryCodeId: line.salaryCodeId,
      month: line.month,
      quantity: line.quantity,
      amount: line.amount,
      sourceCount: line.sourceCount,
    };
    const prev = sum.get(lineKey(l));
    if (prev) {
      prev.quantity += l.quantity;
      prev.amount = l.amount === null ? prev.amount : (prev.amount ?? 0) + l.amount;
      prev.sourceCount += l.sourceCount;
    } else sum.set(lineKey(l), l);
  }
  return [...sum.values()];
}

/** All lines for an export of `month`: its own items plus late deltas for earlier locked months (R7). */
async function linesFor(tx: Tx, month: LocalDate, codes: SalaryCode[]) {
  const own = await currentLines(tx, month, codes);
  const locked = await tx
    .select({ month: schema.payPeriods.month })
    .from(schema.payPeriods)
    .where(and(eq(schema.payPeriods.status, "locked"), lt(schema.payPeriods.month, month)));
  const exported = await exportedBefore(tx, month);
  const late: PayrollLine[] = [];
  for (const l of locked) {
    const now = await currentLines(tx, l.month, codes);
    late.push(
      ...lateDeltas(
        now,
        exported.filter((e) => e.month === l.month),
      ),
    );
  }
  return [...own, ...late];
}

/** Count of items in the month that are not yet approved (they will come as late lines once approved). */
async function unapprovedCounts(tx: Tx, month: LocalDate): Promise<Map<string, number>> {
  const end = lastDayOfMonth(month);
  const out = new Map<string, number>();
  const bump = (u: string) => out.set(u, (out.get(u) ?? 0) + 1);
  const abs = await tx
    .select({ userId: schema.timeEntries.userId })
    .from(schema.timeEntries)
    .innerJoin(schema.absenceCodes, eq(schema.absenceCodes.id, schema.timeEntries.absenceCodeId))
    .where(
      and(
        gte(schema.timeEntries.date, month),
        lte(schema.timeEntries.date, end),
        inArray(schema.timeEntries.status, ["draft", "submitted", "rejected"]),
        isNotNull(schema.absenceCodes.salaryCodeId),
      ),
    );
  for (const a of abs) bump(a.userId);
  const exp = await tx
    .select({ userId: schema.expenses.userId })
    .from(schema.expenses)
    .where(
      and(
        gte(schema.expenses.date, month),
        lte(schema.expenses.date, end),
        inArray(schema.expenses.status, ["submitted"]),
      ),
    );
  for (const e of exp) bump(e.userId);
  return out;
}

/** One preview line for the UI (quantities as decimals, amounts in øre). */
export interface PreviewLine {
  code: string;
  name: string;
  unit: SalaryUnit;
  quantity: number;
  amount: number | null;
  originalPeriod: string | null;
  sourceCount: number;
}

/**
 * Preview of a month's export: one row per employee with their lines and warnings — missing payroll number (row
 * not exported, AC2) and items still awaiting approval (they become late lines once approved).
 */
export async function payrollPreview(tx: Tx, auth: AuthContext, month: LocalDate) {
  const period = (await payPeriods(tx, auth)).find((p) => p.month === month);
  if (!period) throw new AppError(404, "not_found");
  const codes = await tx.select().from(schema.salaryCodes);
  const byId = new Map(codes.map((c) => [c.id, c]));
  const lines =
    period.status === "locked" ? await lockedLines(tx, period.id) : await linesFor(tx, month, codes);
  const unapproved = await unapprovedCounts(tx, month);
  const userIds = [...new Set([...lines.map((l) => l.userId), ...unapproved.keys()])];
  const people = userIds.length
    ? await tx.select().from(schema.users).where(inArray(schema.users.id, userIds))
    : [];
  const rows = people
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((u) => ({
      userId: u.id,
      fullName: u.fullName,
      payrollNumber: u.payrollNumber,
      unapproved: unapproved.get(u.id) ?? 0,
      lines: lines
        .filter((l) => l.userId === u.id)
        .map((l): PreviewLine => {
          const c = byId.get(l.salaryCodeId) as SalaryCode;
          return {
            code: c.code,
            name: c.name,
            unit: c.unit as SalaryUnit,
            quantity: l.quantity / 100,
            amount: l.amount,
            originalPeriod: l.month === month ? null : l.month.slice(0, 7),
            sourceCount: l.sourceCount,
          };
        })
        .sort(
          (a, b) =>
            (a.originalPeriod ?? "").localeCompare(b.originalPeriod ?? "") || a.code.localeCompare(b.code),
        ),
    }));
  const [run] = await tx
    .select({
      id: schema.payrollRuns.id,
      createdAt: schema.payrollRuns.createdAt,
      lineCount: schema.payrollRuns.lineCount,
    })
    .from(schema.payrollRuns)
    .where(eq(schema.payrollRuns.payPeriodId, period.id));
  return { period, run: run ?? null, rows };
}

/** Lines of the (single) run of a locked period, as PayrollLine. */
async function lockedLines(tx: Tx, payPeriodId: string): Promise<PayrollLine[]> {
  const rows = await tx
    .select({ line: schema.payrollLines })
    .from(schema.payrollLines)
    .innerJoin(schema.payrollRuns, eq(schema.payrollRuns.id, schema.payrollLines.runId))
    .where(eq(schema.payrollRuns.payPeriodId, payPeriodId));
  return rows.map(({ line: l }) => ({
    userId: l.userId,
    salaryCodeId: l.salaryCodeId,
    month: l.month,
    quantity: l.quantity,
    amount: l.amount,
    sourceCount: l.sourceCount,
  }));
}

/**
 * Generates (or regenerates) the export for a month: employees without a payroll number are left out, the file
 * replaces any earlier unlocked run (AC4), and the period becomes "exported". Audited.
 */
export async function exportPayroll(tx: Tx, auth: AuthContext, month: LocalDate) {
  const period = await loadPeriod(tx, month);
  if (period.status === "locked") throw new AppError(409, "pay_period_locked");
  const codes = await tx.select().from(schema.salaryCodes);
  const byId = new Map(codes.map((c) => [c.id, c]));
  const people = new Map((await tx.select().from(schema.users)).map((u) => [u.id, u]));
  const lines = (await linesFor(tx, month, codes)).filter((l) => people.get(l.userId)?.payrollNumber);

  await tx.delete(schema.payrollRuns).where(eq(schema.payrollRuns.payPeriodId, period.id));
  const end = lastDayOfMonth(month);
  const rows: PayrollCsvRow[] = lines
    .map((l) => {
      const u = people.get(l.userId);
      const c = byId.get(l.salaryCodeId) as SalaryCode;
      return {
        employeeNumber: u?.payrollNumber ?? "",
        employeeName: u?.fullName ?? "",
        code: c.code,
        providerCode: c.providerCode,
        description: c.name,
        unit: c.unit as SalaryUnit,
        quantity: l.quantity,
        amount: l.amount,
        periodStart: month,
        periodEnd: end,
        originalPeriod: l.month === month ? null : l.month.slice(0, 7),
        sourceCount: l.sourceCount,
      };
    })
    .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber) || a.code.localeCompare(b.code));
  const [run] = await tx
    .insert(schema.payrollRuns)
    .values({
      tenantId: auth.tenantId,
      payPeriodId: period.id,
      csv: payrollCsv(rows),
      lineCount: rows.length,
      createdBy: auth.userId,
    })
    .returning();
  if (!run) throw new AppError(500, "internal_error");
  if (lines.length)
    await tx
      .insert(schema.payrollLines)
      .values(lines.map((l) => ({ tenantId: auth.tenantId, runId: run.id, ...l })));
  await tx
    .update(schema.payPeriods)
    .set({ status: "exported", exportedAt: new Date(), exportedBy: auth.userId })
    .where(eq(schema.payPeriods.id, period.id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "pay_period",
    entityId: period.id,
    action: "export",
    userId: auth.userId,
    after: { month, lines: rows.length },
  });
  return { runId: run.id, lineCount: rows.length };
}

/** Locks an exported month: its lines are frozen; later changes to it become late lines (R8). Earlier months first. */
export async function lockPayPeriod(tx: Tx, auth: AuthContext, month: LocalDate) {
  const period = await loadPeriod(tx, month);
  if (period.status !== "exported") throw new AppError(409, "pay_period_not_exported");
  const [earlierOpen] = await tx
    .select({ id: schema.payPeriods.id })
    .from(schema.payPeriods)
    .where(and(lt(schema.payPeriods.month, month), inArray(schema.payPeriods.status, ["open", "exported"])))
    .limit(1);
  if (earlierOpen) throw new AppError(409, "earlier_pay_period_open");
  await tx
    .update(schema.payPeriods)
    .set({ status: "locked", lockedAt: new Date(), lockedBy: auth.userId })
    .where(eq(schema.payPeriods.id, period.id));
  await writeAudit(tx, {
    tenantId: auth.tenantId,
    entity: "pay_period",
    entityId: period.id,
    action: "lock",
    userId: auth.userId,
    after: { month },
  });
  return { status: "locked" };
}

/** The CSV file of a month's run (404 when not exported yet). */
export async function payrollFile(tx: Tx, month: LocalDate) {
  const period = await loadPeriod(tx, month);
  const [run] = await tx
    .select()
    .from(schema.payrollRuns)
    .where(eq(schema.payrollRuns.payPeriodId, period.id));
  if (!run) throw new AppError(404, "not_found");
  return { filename: `loen_${month.slice(0, 7)}.csv`, csv: run.csv };
}
