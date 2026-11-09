/**
 * Payroll export rules (docs/spec/payroll.md, decision D-023) — GRASP Information Expert for turning approved
 * absence, mileage and expenses into payroll lines. ARCnordic Tid never calculates salary; it only delivers
 * quantities per employee × salary code × month. Pure functions: no I/O.
 *
 * Units: hours in centi-hours, days and km in hundredths (quantity 300 = 3,00), money in øre.
 */
import type { CentiHours } from "./hours.ts";
import type { Minor } from "./money.ts";

/** Unit of a salary code ("lønart"). */
export type SalaryUnit = "hours" | "days" | "km" | "amount";

/**
 * Absence as days (R2): hours ÷ the employee's norm that day, in hundredths of a day. A day without norm counts 0.
 * @example absenceDayFraction(750, 750) // 100 = 1,00 day; absenceDayFraction(375, 750) // 50 = 0,50 day
 */
export function absenceDayFraction(hours: CentiHours, normThatDay: CentiHours): number {
  return normThatDay > 0 ? Math.round((hours * 100) / normThatDay) : 0;
}

/** One payroll line: an employee's total on one salary code for one month (or a late delta for an earlier month). */
export interface PayrollLine {
  userId: string;
  salaryCodeId: string;
  /** first day of the month the items are dated in */
  month: string;
  /** hundredths of the code's unit (hours: centi-hours) */
  quantity: number;
  /** øre; only for amount-based codes and mileage */
  amount: Minor | null;
  sourceCount: number;
}

/** Key identifying employee × salary code × month. */
export const lineKey = (l: Pick<PayrollLine, "userId" | "salaryCodeId" | "month">) =>
  `${l.userId}|${l.salaryCodeId}|${l.month}`;

/**
 * Late items (R7): for months that are already locked, the difference between what the data says now and what was
 * exported in locked runs. Returns only non-zero deltas (negative allowed when something was reduced).
 * @example current 300 days-hundredths, exported 200 → one line with quantity 100
 */
export function lateDeltas(current: PayrollLine[], exported: PayrollLine[]): PayrollLine[] {
  const done = new Map(exported.map((l) => [lineKey(l), l]));
  const keys = new Set([...current.map(lineKey), ...exported.map(lineKey)]);
  const now = new Map(current.map((l) => [lineKey(l), l]));
  const out: PayrollLine[] = [];
  for (const k of keys) {
    const c = now.get(k);
    const e = done.get(k);
    const base = (c ?? e) as PayrollLine;
    const quantity = (c?.quantity ?? 0) - (e?.quantity ?? 0);
    // Only lines that exist carry an amount; a missing side is "nothing", not 0 kr (day/hour codes have no amount).
    const sides = [c, e].filter((l): l is PayrollLine => l !== undefined);
    const amount = sides.every((l) => l.amount === null) ? null : (c?.amount ?? 0) - (e?.amount ?? 0);
    if (quantity !== 0 || (amount ?? 0) !== 0)
      out.push({
        ...base,
        quantity,
        amount,
        sourceCount: Math.max(0, (c?.sourceCount ?? 0) - (e?.sourceCount ?? 0)),
      });
  }
  return out;
}

/** Columns of the generic CSV (R9). */
export const PAYROLL_CSV_HEADER =
  "employee_number;employee_name;salary_code;provider_code;description;quantity;unit;rate;amount;period_start;period_end;original_period;source_count";

const UNIT_DA: Record<SalaryUnit, string> = { hours: "timer", days: "dage", km: "km", amount: "kr" };

/** Hundredths → "3,00" (Danish decimal comma, no thousands separator, sign kept). */
const dec = (hundredths: number) => {
  const sign = hundredths < 0 ? "-" : "";
  const a = Math.abs(hundredths);
  return `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, "0")}`;
};

/** One CSV row's input. */
export interface PayrollCsvRow {
  employeeNumber: string;
  employeeName: string;
  code: string;
  providerCode: string | null;
  description: string;
  unit: SalaryUnit;
  quantity: number;
  amount: Minor | null;
  periodStart: string;
  periodEnd: string;
  /** "YYYY-MM" for late lines from an earlier, locked month */
  originalPeriod: string | null;
  sourceCount: number;
}

/** Escapes a text field for the ;-separated file (quotes when it contains ; " or a line break). */
const field = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

/**
 * Generic payroll CSV (R9): UTF-8 with BOM, `;` separator, Danish decimal comma, ISO dates, CRLF line ends.
 * @example row → "1042;Mette Holm;FERIE;31;Ferie;3,00;dage;;;2027-03-01;2027-03-31;;3"
 */
export function payrollCsv(rows: PayrollCsvRow[]): string {
  const lines = rows.map((r) =>
    [
      field(r.employeeNumber),
      field(r.employeeName),
      field(r.code),
      field(r.providerCode ?? ""),
      field(r.description),
      dec(r.quantity),
      UNIT_DA[r.unit],
      "",
      r.amount === null ? "" : dec(r.amount),
      r.periodStart,
      r.periodEnd,
      r.originalPeriod ?? "",
      String(r.sourceCount),
    ].join(";"),
  );
  return `﻿${[PAYROLL_CSV_HEADER, ...lines].join("\r\n")}\r\n`;
}
