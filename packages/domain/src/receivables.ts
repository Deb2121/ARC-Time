/**
 * Debitorliste (receivables) — docs/spec/case-finance.md §5, decision D-029. Pure functions for outstanding
 * amounts, days overdue, status (Åben, Forfalden X dage, Delvist betalt, Betalt) and ageing buckets.
 * Amounts in øre incl. VAT. Dates are LocalDate strings in Europe/Copenhagen.
 */
import { daysBetween, type LocalDate } from "./dates.ts";
import type { Minor } from "./money.ts";

/** Invoice payment status shown in the debtor list ("krediteret": settled by credit notes, nothing paid). */
export type DebtStatus = "aaben" | "forfalden" | "delvist_betalt" | "betalt" | "krediteret";

/** Ageing bucket by days overdue. */
export type AgeingBucket = "ikke_forfalden" | "d1_30" | "d31_60" | "d61_90" | "over_90";

/** Buckets in display order (the ageing cards). */
export const AGEING_BUCKETS: readonly AgeingBucket[] = [
  "ikke_forfalden",
  "d1_30",
  "d31_60",
  "d61_90",
  "over_90",
];

/** What the debtor list knows about one booked invoice. */
export interface DebtInput {
  /** invoice total incl. VAT */
  total: Minor;
  /** booked credit notes against it, as a positive amount incl. VAT */
  credited: Minor;
  /** sum of registered payments */
  paid: Minor;
  dueDate: LocalDate;
}

/** Computed debtor-list values for one invoice. */
export interface Debt {
  outstanding: Minor;
  daysOverdue: number;
  status: DebtStatus;
  bucket: AgeingBucket | null;
}

/** Ageing bucket for a number of days overdue (0 or less = not due). */
export function ageingBucket(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return "ikke_forfalden";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "over_90";
}

/**
 * Outstanding amount, days overdue, status and ageing bucket of one invoice on `today`. A paid invoice has no
 * bucket. A part-paid invoice is "delvist_betalt" even when overdue (the days are still reported).
 * @example due 4. nov. 2026, viewed 10. nov. 2026 → daysOverdue 6, status "forfalden", bucket "d1_30"
 */
export function debt(d: DebtInput, today: LocalDate): Debt {
  const outstanding = Math.max(0, d.total - d.credited - d.paid);
  const daysOverdue = Math.max(0, daysBetween(d.dueDate, today));
  if (outstanding === 0)
    return {
      outstanding,
      daysOverdue: 0,
      status: d.paid === 0 && d.credited > 0 ? "krediteret" : "betalt",
      bucket: null,
    };
  const status: DebtStatus = d.paid > 0 ? "delvist_betalt" : daysOverdue > 0 ? "forfalden" : "aaben";
  return { outstanding, daysOverdue, status, bucket: ageingBucket(daysOverdue) };
}

/** "6 dage forfalden" / "1 dag forfalden". */
export const overdueText = (days: number): string => `${days} ${days === 1 ? "dag" : "dage"} forfalden`;

/** Outstanding amounts per ageing bucket plus the total (the ageing cards above the debtor list). */
export function ageingSummary(debts: readonly Pick<Debt, "outstanding" | "bucket">[]) {
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, Minor>;
  let total = 0;
  for (const x of debts) {
    if (!x.bucket || x.outstanding <= 0) continue;
    buckets[x.bucket] += x.outstanding;
    total += x.outstanding;
  }
  return { total, buckets };
}

/**
 * Validates a payment registration: positive, and not more than what is outstanding.
 * Returns an error code or null.
 */
export function paymentError(
  amount: Minor,
  outstanding: Minor,
): "payment_not_positive" | "payment_exceeds_outstanding" | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return "payment_not_positive";
  if (amount > outstanding) return "payment_exceeds_outstanding";
  return null;
}

/** Reminder (rykker) levels 1–3; the next level must follow the last one sent. */
export function nextReminderError(
  level: number,
  sentLevels: readonly number[],
): "reminder_level_invalid" | "reminder_out_of_order" | null {
  if (!Number.isInteger(level) || level < 1 || level > 3) return "reminder_level_invalid";
  const last = sentLevels.length ? Math.max(...sentLevels) : 0;
  if (level !== last + 1) return "reminder_out_of_order";
  return null;
}
