/**
 * Rate plan generator for large fixed-price cases ("rateplan", decision D-039) — modelled on Finance's Excel sheet
 * for Baltoppen. GRASP Information Expert: the one place that knows how a total fee is built up per phase, how
 * sub-consultants' fees are split, and how each phase is cut into instalments. Pure functions; all amounts in øre.
 *
 *   1. Fee per phase = the phase's own fee + its share of the fee parts to distribute ("honorardele til fordeling",
 *      e.g. projekteringsledelse over phases 1–4), shared in proportion to the phases' own fees.
 *   2. Sub-consultants: either a fixed amount per phase, or a total split by each phase's share of the total fee.
 *      ARCnordic's share of a phase is what is left: phase fee − the sub-consultants' amounts.
 *   3. Each phase is invoiced in instalments from a start month with a pattern of weights, one month apart:
 *      [1,1,1] = three equal thirds, [2,1] = 2/3 then 1/3, [1,2,2,2,2,1] = tenths. Phases may overlap, so two
 *      instalments in the same month are fine. Instalments are numbered by date, then by phase order.
 *
 * Every split uses the largest remainder method, so the parts always add up to the whole to the øre — unlike the
 * spreadsheet's floating point (4.789.999,999…). The checks list what must be fixed before the plan is used.
 */
import type { LocalDate } from "./dates.ts";
import type { Minor } from "./money.ts";

/** One phase of the fee, with its own fee and its instalment schedule. */
export interface FeePhaseInput {
  /** stable key within the plan (e.g. the task id) */
  key: string;
  name: string;
  /** the phase's own fee, øre */
  baseFee: Minor;
  /** the case task (phase) the instalments belong to, if any */
  taskId?: string | null | undefined;
  /** first instalment month "YYYY-MM" */
  start: string;
  /** relative size of each instalment, one month apart; [1] = one instalment */
  weights: number[];
}

/** A fee part distributed over some phases in proportion to their own fee (e.g. projekteringsledelse). */
export interface FeePoolInput {
  name: string;
  amount: Minor;
  phaseKeys: string[];
}

/** A sub-consultant's fee: fixed amounts per phase, or a total split by the phases' shares of the total fee. */
export interface SubConsultantInput {
  name: string;
  mode: "fixed" | "share";
  /** mode "share": the sub-consultant's total fee, øre */
  total?: Minor | undefined;
  /** mode "fixed": amount per phase key, øre */
  perPhase?: Record<string, Minor> | undefined;
}

/** Everything the generator needs. */
export interface FeePlanInput {
  phases: FeePhaseInput[];
  pools: FeePoolInput[];
  subs: SubConsultantInput[];
}

/** A phase's fee build-up. */
export interface FeePhaseResult {
  key: string;
  name: string;
  taskId: string | null;
  baseFee: Minor;
  /** share of each pool, in the order of `input.pools` */
  poolShares: Minor[];
  total: Minor;
  /** share of the total fee in basis points (10000 = 100 %) */
  shareBp: number;
  /** each sub-consultant's amount on the phase, in the order of `input.subs` */
  subAmounts: Minor[];
  /** ARCnordic's part: total − sub-consultants */
  own: Minor;
}

/** One generated instalment. */
export interface FeeInstalment {
  /** 1, 2, 3 … by date, then phase order */
  sequence: number;
  phaseKey: string;
  phaseName: string;
  taskId: string | null;
  /** first day of the month */
  date: LocalDate;
  amount: Minor;
  /** in the order of `input.subs` */
  subAmounts: Minor[];
  own: Minor;
  /** "Rate 1 · Projektforslag" */
  description: string;
}

/** Something that must be fixed before the plan can be used. */
export type FeePlanProblem =
  | { code: "no_phases" }
  | { code: "bad_amount"; where: string }
  | { code: "bad_start"; phase: string }
  | { code: "bad_weights"; phase: string }
  | { code: "pool_without_phases"; pool: string }
  | { code: "pool_unknown_phase"; pool: string }
  | { code: "sub_over_phase"; sub: string; phase: string }
  | { code: "zero_total" };

/** The generated plan with its control sums. */
export interface FeePlanResult {
  phases: FeePhaseResult[];
  instalments: FeeInstalment[];
  /** total fee = Σ phase totals = Σ instalments */
  total: Minor;
  /** each sub-consultant's total, in the order of `input.subs` */
  subTotals: Minor[];
  own: Minor;
  problems: FeePlanProblem[];
}

/**
 * Splits `amount` in proportion to `weights` so the parts add up exactly (largest remainder; ties go to the first).
 * All-zero weights split equally. @example allocateByWeights(100, [1, 1, 1]) // [34, 33, 33]
 */
export function allocateByWeights(amount: Minor, weights: readonly number[]): Minor[] {
  if (!weights.length) return [];
  const w = weights.every((x) => x <= 0) ? weights.map(() => 1) : weights.map((x) => Math.max(0, x));
  const sum = w.reduce((a, x) => a + x, 0);
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const exact = w.map((x) => (abs * x) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = abs - parts.reduce((a, x) => a + x, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    parts[o.i] = (parts[o.i] ?? 0) + 1;
    left--;
  }
  return parts.map((x) => x * sign);
}

/** "2026-11" plus `n` months → "2027-02-01". */
export function monthPlus(start: string, n: number): LocalDate {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = (((m % 12) + 12) % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}

const isMoney = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;

/**
 * Builds the fee per phase, the sub-consultants' shares and the instalments, and lists any problems.
 * @example Baltoppen: 7 phases, 3 fee parts, 2 sub-consultants → 22 instalments that add up to 4.790.000,00 kr.
 */
export function computeFeePlan(input: FeePlanInput): FeePlanResult {
  const problems: FeePlanProblem[] = [];
  const phases = input.phases;
  if (!phases.length) problems.push({ code: "no_phases" });
  const keys = new Set(phases.map((p) => p.key));

  for (const p of phases) {
    if (!isMoney(p.baseFee)) problems.push({ code: "bad_amount", where: p.name });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.start)) problems.push({ code: "bad_start", phase: p.name });
    if (!p.weights.length || p.weights.some((w) => !Number.isFinite(w) || w <= 0))
      problems.push({ code: "bad_weights", phase: p.name });
  }

  // 1. fee parts distributed over their phases in proportion to the phases' own fees
  const poolShares = phases.map(() => input.pools.map(() => 0));
  input.pools.forEach((pool, j) => {
    if (!isMoney(pool.amount)) problems.push({ code: "bad_amount", where: pool.name });
    if (!pool.phaseKeys.length) {
      problems.push({ code: "pool_without_phases", pool: pool.name });
      return;
    }
    if (pool.phaseKeys.some((k) => !keys.has(k)))
      problems.push({ code: "pool_unknown_phase", pool: pool.name });
    const idx = phases.flatMap((p, i) => (pool.phaseKeys.includes(p.key) ? [i] : []));
    const parts = allocateByWeights(
      pool.amount,
      idx.map((i) => phases[i]?.baseFee ?? 0),
    );
    idx.forEach((i, n) => {
      const row = poolShares[i];
      if (row) row[j] = parts[n] ?? 0;
    });
  });
  const totals = phases.map((p, i) => p.baseFee + (poolShares[i] ?? []).reduce((a, x) => a + x, 0));
  const total = totals.reduce((a, x) => a + x, 0);
  if (phases.length && total <= 0) problems.push({ code: "zero_total" });

  // 2. sub-consultants per phase
  const subPerPhase = input.subs.map((s) => {
    if (s.mode === "share") {
      if (!isMoney(s.total ?? 0)) problems.push({ code: "bad_amount", where: s.name });
      return allocateByWeights(s.total ?? 0, totals);
    }
    return phases.map((p) => {
      const v = s.perPhase?.[p.key] ?? 0;
      if (!isMoney(v)) problems.push({ code: "bad_amount", where: s.name });
      return v;
    });
  });
  const phaseResults: FeePhaseResult[] = phases.map((p, i) => {
    const subAmounts = subPerPhase.map((s) => s[i] ?? 0);
    const t = totals[i] ?? 0;
    const own = t - subAmounts.reduce((a, x) => a + x, 0);
    if (own < 0)
      input.subs.forEach((s, j) => {
        if ((subAmounts[j] ?? 0) > 0) problems.push({ code: "sub_over_phase", sub: s.name, phase: p.name });
      });
    return {
      key: p.key,
      name: p.name,
      taskId: p.taskId ?? null,
      baseFee: p.baseFee,
      poolShares: poolShares[i] ?? [],
      total: t,
      shareBp: total > 0 ? Math.round((t * 10_000) / total) : 0,
      subAmounts,
      own,
    };
  });

  // 3. instalments per phase, the sub-consultants' amounts cut by the same pattern
  const raw: Omit<FeeInstalment, "sequence" | "description">[] = [];
  const validStart = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  phases.forEach((p, i) => {
    const ph = phaseResults[i];
    if (!ph || !validStart(p.start) || !p.weights.length || p.weights.some((w) => !(w > 0))) return;
    const amounts = allocateByWeights(ph.total, p.weights);
    const subs = ph.subAmounts.map((a) => allocateByWeights(a, p.weights));
    p.weights.forEach((_, n) => {
      const subAmounts = subs.map((s) => s[n] ?? 0);
      const amount = amounts[n] ?? 0;
      raw.push({
        phaseKey: p.key,
        phaseName: p.name,
        taskId: p.taskId ?? null,
        date: monthPlus(p.start, n),
        amount,
        subAmounts,
        own: amount - subAmounts.reduce((a, x) => a + x, 0),
      });
    });
  });
  const phaseOrder = new Map(phases.map((p, i) => [p.key, i]));
  const instalments = raw
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        a.r.date.localeCompare(b.r.date) ||
        (phaseOrder.get(a.r.phaseKey) ?? 0) - (phaseOrder.get(b.r.phaseKey) ?? 0) ||
        a.i - b.i,
    )
    .map(({ r }, n) => ({ ...r, sequence: n + 1, description: `Rate ${n + 1} · ${r.phaseName}` }));

  const subTotals = input.subs.map((_, j) => phaseResults.reduce((a, p) => a + (p.subAmounts[j] ?? 0), 0));
  return {
    phases: phaseResults,
    instalments,
    total,
    subTotals,
    own: total - subTotals.reduce((a, x) => a + x, 0),
    problems,
  };
}
