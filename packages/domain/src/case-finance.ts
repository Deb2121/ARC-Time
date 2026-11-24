/**
 * Sagsøkonomi (case finance) — docs/spec/case-finance.md, decision D-029. Pure calculations of hours and money
 * per case for both fee types (honorarform): medgået tid (time & material) and fast honorar (fixed fee; retainers
 * are shown as fast honorar). Money in øre, hours in centi-hours, percentages in basis points.
 *
 * Ekstraarbejde: phases flagged as extra work on a fixed-fee case are billed as medgået tid. Their hours count in
 * timer/forbrugt/kostpris for the case, but not against the fee (forbrugtPct, resthonorar).
 */
import type { CentiHours } from "./hours.ts";
import { divRound, hoursTimesRate, type Minor } from "./money.ts";

/** Honorarform shown on the case: medgået tid or fast honorar. */
export type FeeType = "medgaaet_tid" | "fast_honorar";

/** Contract type in the data model (contracts.type). */
export type ContractType = "time_material" | "fixed_price" | "retainer";

/** Fee type of a contract: time & material is medgået tid, fixed price and retainer are fast honorar. */
export const feeTypeOf = (contractType: ContractType): FeeType =>
  contractType === "time_material" ? "medgaaet_tid" : "fast_honorar";

/** One time entry on the case as the calculations need it. */
export interface CaseEntry {
  userId: string;
  taskId: string;
  hours: CentiHours;
  /** sales rate per hour in øre: the approval snapshot, or the current estimate for unapproved hours */
  salesRate: Minor;
  /** internal cost rate per hour in øre */
  costRate: Minor;
  billable: boolean;
  status: "draft" | "submitted" | "approved" | "invoiced";
  /** the entry is on a phase billed as medgået tid (always true on a medgået tid case; ekstraarbejde on a fixed fee) */
  timeAndMaterial: boolean;
}

/** Thresholds for the fee warning (configurable per tenant), in basis points of the fee. */
export interface FeeThresholds {
  warningBp: number;
  alertBp: number;
}

/** Default thresholds: warning at 75 %, alert above 100 %. */
export const DEFAULT_FEE_THRESHOLDS: FeeThresholds = { warningBp: 7_500, alertBp: 10_000 };

/** Fee consumption level: ok, warning (≥ warning threshold) or alert (> alert threshold). */
export type FeeLevel = "ok" | "warning" | "alert";

/** Everything the case overview shows about money and hours on one case. */
export interface CaseFinance {
  feeType: FeeType;
  hours: { total: CentiHours; byTask: Map<string, CentiHours>; byUser: Map<string, CentiHours> };
  /** Σ hours × sales rate (billable hours) */
  forbrugt: Minor;
  /** forbrugt per phase (task id) and per employee (user id) */
  forbrugtByTask: Map<string, Minor>;
  forbrugtByUser: Map<string, Minor>;
  /** Σ hours × internal cost rate, plus sub-consultants' invoices (externalCost, D-041) */
  kostpris: Minor;
  /** of which sub-consultants' invoices (D-041) */
  externalCost: Minor;
  /** Σ booked invoice lines for the case, net excl. VAT (credit notes deducted) */
  faktureret: Minor;
  /** approved, not yet invoiced medgået tid hours × rate (work in progress) */
  ikkeFaktureret: Minor;
  /** fixed fee only */
  fee: Minor | null;
  /** fixed fee only: fee − invoiced against the fee */
  resthonorar: Minor | null;
  /** fixed fee only: forbrugt (excluding ekstraarbejde) ÷ fee, in basis points */
  forbrugtPct: number | null;
  feeLevel: FeeLevel | null;
}

/** Input for one case. */
export interface CaseFinanceInput {
  feeType: FeeType;
  /** fixed fee in øre (sum of the case's fixed-price/retainer contracts); ignored for medgået tid */
  fee: Minor | null;
  entries: readonly CaseEntry[];
  /** booked invoice lines (net) for the whole case, credit notes as negative amounts */
  invoicedTotal: Minor;
  /** of which booked against the fee (instalment / a conto lines) */
  invoicedAgainstFee: Minor;
  /** sub-consultants' invoices registered on the case (D-041), excl. VAT; added to kostpris */
  externalCost?: Minor | undefined;
  thresholds?: FeeThresholds;
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** Fee consumption level for a percentage of the fee. 7500 bp with default thresholds → "warning". */
export function feeLevel(forbrugtPctBp: number, t: FeeThresholds = DEFAULT_FEE_THRESHOLDS): FeeLevel {
  if (forbrugtPctBp > t.alertBp) return "alert";
  if (forbrugtPctBp >= t.warningBp) return "warning";
  return "ok";
}

/**
 * Hours and money for one case: timer (total, per phase, per employee), forbrugt, kostpris, faktureret,
 * ikke faktureret and — on a fixed fee — resthonorar, forbrugt % of fee and the warning level.
 * @example 454.700 kr forbrugt on a 600.000 kr fee → forbrugtPct 7578 bp, level "warning"
 */
export function caseFinance(input: CaseFinanceInput): CaseFinance {
  const byTask = new Map<string, CentiHours>();
  const byUser = new Map<string, CentiHours>();
  const forbrugtByTask = new Map<string, Minor>();
  const forbrugtByUser = new Map<string, Minor>();
  let total = 0;
  let forbrugt = 0;
  let forbrugtOnFee = 0;
  let kostpris = 0;
  let ikkeFaktureret = 0;
  for (const e of input.entries) {
    total += e.hours;
    add(byTask, e.taskId, e.hours);
    add(byUser, e.userId, e.hours);
    kostpris += hoursTimesRate(e.hours, e.costRate);
    if (!e.billable) continue;
    const value = hoursTimesRate(e.hours, e.salesRate);
    forbrugt += value;
    add(forbrugtByTask, e.taskId, value);
    add(forbrugtByUser, e.userId, value);
    if (!e.timeAndMaterial) forbrugtOnFee += value;
    // Approved but not invoiced: the status turns "invoiced" when the invoice is booked, so a draft still counts.
    if (e.timeAndMaterial && e.status === "approved") ikkeFaktureret += value;
  }
  const fixed = input.feeType === "fast_honorar";
  const fee = fixed ? (input.fee ?? 0) : null;
  const pct = fee !== null && fee > 0 ? divRound(forbrugtOnFee * 10_000, fee) : null;
  return {
    feeType: input.feeType,
    hours: { total, byTask, byUser },
    forbrugt,
    forbrugtByTask,
    forbrugtByUser,
    kostpris: kostpris + (input.externalCost ?? 0),
    externalCost: input.externalCost ?? 0,
    faktureret: input.invoicedTotal,
    ikkeFaktureret,
    fee,
    resthonorar: fee !== null ? fee - input.invoicedAgainstFee : null,
    forbrugtPct: pct,
    feeLevel: pct !== null ? feeLevel(pct, input.thresholds) : null,
  };
}

/**
 * Warning text on a fixed-fee case, rounded to whole percent. @example feeWarningText(7578) // "76 % af honorar forbrugt"
 */
export const feeWarningText = (forbrugtPctBp: number): string =>
  `${Math.round(forbrugtPctBp / 100)} % af honorar forbrugt`;

/** Status label of a case row in the overview (Danish labels in the UI). */
export type CaseStatus =
  | "honorar_overskredet"
  | "overskridelsesrisiko"
  | "rate_klar"
  | "kan_faktureres"
  | "ajour";

/**
 * One status per case, most urgent first: Honorar overskredet → Overskridelsesrisiko → Rate klar →
 * Kan faktureres → Ajour.
 */
export function caseStatus(
  f: Pick<CaseFinance, "feeLevel" | "ikkeFaktureret">,
  readyInstalments: number,
): CaseStatus {
  if (f.feeLevel === "alert") return "honorar_overskredet";
  if (f.feeLevel === "warning") return "overskridelsesrisiko";
  if (readyInstalments > 0) return "rate_klar";
  if (f.ikkeFaktureret > 0) return "kan_faktureres";
  return "ajour";
}

/** Filters of the case overview; an empty value means "all". */
export interface CaseFilter {
  feeType?: FeeType | "";
  managerId?: string;
  customerId?: string;
  status?: CaseStatus | "";
}

/** True when a case row passes the overview filters (used by the screen and the Excel export alike). */
export function matchesCaseFilter(
  row: { feeType: FeeType; managerId: string | null; customerId: string; caseStatus: CaseStatus },
  f: CaseFilter,
): boolean {
  return (
    (!f.feeType || row.feeType === f.feeType) &&
    (!f.managerId || row.managerId === f.managerId) &&
    (!f.customerId || row.customerId === f.customerId) &&
    (!f.status || row.caseStatus === f.status)
  );
}

/** Sums of the money columns over rows, for the totals row (always the rows currently shown). */
export function sumRows<K extends string>(
  rows: readonly Partial<Record<K, number | null>>[],
  keys: readonly K[],
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = rows.reduce<number>((a, r) => a + (r[k] ?? 0), 0);
  return out;
}
