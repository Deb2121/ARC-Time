/**
 * Invoice suggestion builder, write-down spreading and totals (brief §4.10, docs/spec/invoicing.md).
 * All money in øre, hours in centi-hours.
 */
import { addDays, type LocalDate } from "./dates.ts";
import type { CentiHours } from "./hours.ts";
import { divRound, hoursTimesRate, type Minor, percentOf } from "./money.ts";

export const DANISH_VAT_BP = 2500;

export interface InvoiceableEntry {
  id: string;
  date: LocalDate;
  hours: CentiHours;
  /** snapshotted sales rate (øre/h) */
  rate: Minor;
  taskId: string;
  taskLabel: string;
  userId: string;
  userLabel: string;
  status: string;
  invoiceLineId: string | null;
  billable: boolean;
}

export type Grouping = "task" | "employee" | "task_employee" | "summary";

export interface SourceAllocation {
  entryId: string;
  hours: CentiHours;
  /** registered value hours × rate */
  value: Minor;
  /** value carried on the invoice (after write-down/up spreading) */
  invoiced: Minor;
}

export interface SuggestedLine {
  description: string;
  quantity: CentiHours;
  /** unit price shown on the line; amount = Σ sources, so it may differ from quantity × unitPrice by rounding */
  unitPrice: Minor;
  amount: Minor;
  sources: SourceAllocation[];
}

/**
 * Only approved, billable entries not yet on an invoice are invoiceable. Brief §9: an invoiced entry never appears
 * in a new suggestion — status "invoiced" and a set invoiceLineId both exclude it.
 */
export const isInvoiceable = (e: InvoiceableEntry): boolean =>
  e.status === "approved" && e.billable && e.invoiceLineId === null && e.hours > 0;

/**
 * Builds invoice lines from invoiceable time entries, grouped per task, employee, task + employee, or one summary line.
 * Only approved, billable, not-yet-invoiced entries are used (see `isInvoiceable`). Each line keeps its source
 * allocations; amount = Σ hours × rate (øre) exactly, unit price is the rate or the weighted average for mixed rates.
 */
export function buildTimeLines(
  entries: InvoiceableEntry[],
  grouping: Grouping,
  summaryLabel = "Rådgivning",
): SuggestedLine[] {
  const groups = new Map<string, { description: string; items: InvoiceableEntry[] }>();
  for (const e of entries.filter(isInvoiceable)) {
    const key =
      grouping === "task"
        ? e.taskId
        : grouping === "employee"
          ? e.userId
          : grouping === "task_employee"
            ? `${e.taskId}|${e.userId}`
            : "all";
    const description =
      grouping === "task"
        ? e.taskLabel
        : grouping === "employee"
          ? e.userLabel
          : grouping === "task_employee"
            ? `${e.taskLabel} – ${e.userLabel}`
            : summaryLabel;
    const g = groups.get(key) ?? { description, items: [] };
    g.items.push(e);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ description, items }) => {
    const sources = items.map((e) => {
      const value = hoursTimesRate(e.hours, e.rate);
      return { entryId: e.id, hours: e.hours, value, invoiced: value };
    });
    const quantity = sources.reduce((a, s) => a + s.hours, 0);
    const amount = sources.reduce((a, s) => a + s.value, 0);
    const rates = new Set(items.map((e) => e.rate));
    const unitPrice =
      rates.size === 1 ? (items[0]?.rate ?? 0) : quantity > 0 ? divRound(amount * 100, quantity) : 0;
    return { description, quantity, unitPrice, amount, sources };
  });
}

/**
 * Spreads a changed line amount over its sources proportionally to their registered value, using the largest
 * remainder method so the parts always add up exactly to the new amount. Used for write-down / write-up.
 */
export function spreadAmount(sources: SourceAllocation[], newAmount: Minor): SourceAllocation[] {
  const base = sources.reduce((a, s) => a + s.value, 0);
  if (sources.length === 0) return [];
  if (base === 0) {
    const each = Math.trunc(newAmount / sources.length);
    let rest = newAmount - each * sources.length;
    return sources.map((s) => {
      const extra = rest > 0 ? 1 : rest < 0 ? -1 : 0;
      rest -= extra;
      return { ...s, invoiced: each + extra };
    });
  }
  const raw = sources.map((s) => (s.value * newAmount) / base);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = newAmount - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] = (floored[i] ?? 0) + 1;
    remainder--;
  }
  return sources.map((s, i) => ({ ...s, invoiced: floored[i] ?? 0 }));
}

export interface TotalsLine {
  amount: Minor;
  vatBp: number;
}

export interface InvoiceTotals {
  subtotal: Minor;
  vat: Minor;
  total: Minor;
  /** VAT per rate, for the invoice footer */
  vatByRate: { vatBp: number; base: Minor; vat: Minor }[];
}

/** VAT is calculated per VAT rate on the summed base (not per line) to avoid rounding drift. */
export function invoiceTotals(lines: TotalsLine[]): InvoiceTotals {
  const byRate = new Map<number, Minor>();
  for (const l of lines) byRate.set(l.vatBp, (byRate.get(l.vatBp) ?? 0) + l.amount);
  const vatByRate = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([vatBp, base]) => ({ vatBp, base, vat: percentOf(base, vatBp) }));
  const subtotal = vatByRate.reduce((a, r) => a + r.base, 0);
  const vat = vatByRate.reduce((a, r) => a + r.vat, 0);
  return { subtotal, vat, total: subtotal + vat, vatByRate };
}

/**
 * Due date from invoice date and payment terms in days. @example dueDate("2026-11-30", 30) // "2026-12-30"
 */
export const dueDate = (invoiceDate: LocalDate, paymentTermsDays: number): LocalDate =>
  addDays(invoiceDate, paymentTermsDays);

/** Line amount from quantity (centi-hours or centi-units), unit price and discount (basis points). */
export function lineAmount(quantity: number, unitPrice: Minor, discountBp = 0): Minor {
  const gross = divRound(quantity * unitPrice, 100);
  return gross - percentOf(gross, discountBp);
}

/** Invoice line kinds that carry an amount (count in totals/VAT); headings, texts and subtotals do not. */
export const AMOUNT_LINE_KINDS = ["time", "expense", "milestone", "product"] as const;

/** True for line kinds that carry an amount. @example isAmountLine("expense") // true; isAmountLine("text") // false */
export const isAmountLine = (kind: string): boolean =>
  (AMOUNT_LINE_KINDS as readonly string[]).includes(kind);
