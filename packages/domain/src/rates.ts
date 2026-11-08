/**
 * Hourly rate resolution (brief §4.9, docs/spec/rates.md).
 * Order: 1 project-specific employee rate → 2 project price list → 3 customer price list → 4 standard price list
 * → 5 employee default rate. Within a price list the most specific line wins: price group + task type, then task
 * type only, then price group only, then a catch-all line. Each candidate is effective from `validFrom` (inclusive);
 * the latest one not after the entry date applies. The result is snapshotted on the entry at approval.
 */
import type { LocalDate } from "./dates.ts";
import type { Minor } from "./money.ts";

export interface PriceListRate {
  priceGroupId: string | null;
  taskTypeId: string | null;
  rate: Minor;
  validFrom: LocalDate;
}

export interface ProjectEmployeeRate {
  userId: string;
  rate: Minor;
  validFrom: LocalDate;
}

export interface RateContext {
  date: LocalDate;
  userId: string;
  priceGroupId: string | null;
  taskTypeId: string | null;
  projectEmployeeRates: ProjectEmployeeRate[];
  projectList: PriceListRate[] | null;
  customerList: PriceListRate[] | null;
  standardList: PriceListRate[] | null;
  employeeDefault: Minor;
}

export type RateSource =
  | "project_employee"
  | "project_list"
  | "customer_list"
  | "standard_list"
  | "employee_default";

export interface ResolvedRate {
  rate: Minor;
  source: RateSource;
}

function latest<T extends { validFrom: LocalDate }>(xs: T[], date: LocalDate): T | undefined {
  let best: T | undefined;
  for (const x of xs) if (x.validFrom <= date && (!best || x.validFrom > best.validFrom)) best = x;
  return best;
}

/** Most specific matching line of one price list, or undefined. */
export function matchPriceList(
  list: PriceListRate[],
  priceGroupId: string | null,
  taskTypeId: string | null,
  date: LocalDate,
): PriceListRate | undefined {
  const tiers: ((r: PriceListRate) => boolean)[] = [
    (r) =>
      r.priceGroupId !== null &&
      r.priceGroupId === priceGroupId &&
      r.taskTypeId !== null &&
      r.taskTypeId === taskTypeId,
    (r) => r.priceGroupId === null && r.taskTypeId !== null && r.taskTypeId === taskTypeId,
    (r) => r.priceGroupId !== null && r.priceGroupId === priceGroupId && r.taskTypeId === null,
    (r) => r.priceGroupId === null && r.taskTypeId === null,
  ];
  for (const tier of tiers) {
    const hit = latest(list.filter(tier), date);
    if (hit) return hit;
  }
  return undefined;
}

export function resolveRate(c: RateContext): ResolvedRate {
  const own = latest(
    c.projectEmployeeRates.filter((r) => r.userId === c.userId),
    c.date,
  );
  if (own) return { rate: own.rate, source: "project_employee" };
  const lists: [PriceListRate[] | null, RateSource][] = [
    [c.projectList, "project_list"],
    [c.customerList, "customer_list"],
    [c.standardList, "standard_list"],
  ];
  for (const [list, source] of lists) {
    if (!list) continue;
    const hit = matchPriceList(list, c.priceGroupId, c.taskTypeId, c.date);
    if (hit) return { rate: hit.rate, source };
  }
  return { rate: c.employeeDefault, source: "employee_default" };
}
