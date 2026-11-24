"use client";

/**
 * "Udlæg/kørsel" row under the hours in Min uge: per day, the employee's registered expenses and mileage (sum) and a
 * "+" that opens the expense form with the date filled in (the menu opens upwards: the grid scrolls sideways and
 * would clip it below). The expenses themselves live on /expenses (own approval).
 */

import { monthOf } from "@arc-tid/domain";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { fmtKr } from "@/lib/format";

interface ExpenseRow {
  id: string;
  date: string;
  kind: "expense" | "mileage";
  grossAmount: number;
  status: string;
}

/** Per-day cells for the "Udlæg/kørsel" row of the week grid. */
export function useWeekExpenseCells(
  days: { date: string }[],
  today: string,
  enabled: boolean,
): Record<string, ReactNode> | null {
  const { t, locale } = useI18n();
  const first = days[0]?.date ?? today;
  const last = days[days.length - 1]?.date ?? today;
  // a week can span two months
  const months = [...new Set([monthOf(first), monthOf(last)])];
  const q = useQuery({
    queryKey: ["expenses", "week", first],
    queryFn: async () =>
      (await Promise.all(months.map((m) => api<ExpenseRow[]>(`/expenses?month=${m}`)))).flat(),
    enabled,
  });
  if (!enabled) return null;
  const cells: Record<string, ReactNode> = {};
  for (const d of days) {
    const mine = (q.data ?? []).filter((e) => e.date === d.date && e.status !== "rejected");
    const sum = mine.reduce((a, e) => a + e.grossAmount, 0);
    const future = d.date > today;
    cells[d.date] = (
      <span className="flex flex-col items-center gap-0.5">
        {mine.length > 0 && (
          <Link
            href={`/expenses?month=${monthOf(d.date)}`}
            className="text-xs font-semibold text-ink-900 hover:underline"
            title={t("ts.exp.count", { count: mine.length })}
          >
            {fmtKr(sum, locale)}
          </Link>
        )}
        {!future && (
          <details className="relative">
            <summary
              className="cursor-pointer list-none rounded-[var(--radius-control)] border border-line px-2 text-xs font-semibold text-ink-700 hover:border-brand-600 hover:text-brand-700 [&::-webkit-details-marker]:hidden"
              aria-label={t("ts.exp.add")}
              title={t("ts.exp.add")}
            >
              +
            </summary>
            <span className="absolute bottom-full left-1/2 z-20 mb-1 flex -translate-x-1/2 flex-col rounded-md border border-line bg-surface py-1 text-left shadow-lg">
              <Link
                href={`/expenses?new=expense&date=${d.date}`}
                className="whitespace-nowrap px-3 py-1.5 text-sm text-ink-900 hover:bg-surface-alt"
              >
                {t("ex.newExpense")}
              </Link>
              <Link
                href={`/expenses?new=mileage&date=${d.date}`}
                className="whitespace-nowrap px-3 py-1.5 text-sm text-ink-900 hover:bg-surface-alt"
              >
                {t("ex.newMileage")}
              </Link>
            </span>
          </details>
        )}
      </span>
    );
  }
  return cells;
}
