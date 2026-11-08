"use client";
/**
 * Home-page dashboard pieces (pure view components): the role-based to-do list and the key-figure
 * panel, both fed by GET /me/dashboard (apps/api/src/services/dashboard.ts). Texts live in i18n under `db.*`.
 */

import { isoWeek, utilisation } from "@arc-tid/domain";
import { Card } from "@arc-tid/ui";
import Link from "next/link";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { fmtDay, fmtKr, fmtPct } from "@/lib/format";

/** One to-do as returned by the API. */
export interface Todo {
  kind: string;
  href: string;
  count?: number;
  ref?: string;
  severity: "info" | "warning";
}

/** One complete ISO week of key figures (hours as decimals, percentages in basis points). */
export interface WeekKpi {
  weekStart: string;
  norm: number;
  work: number;
  billable: number;
  utilisationBp: number | null;
  billableBp: number | null;
}

/** Invoiced revenue for one month (øre), with the effective hourly rate (øre per hour). */
export interface MonthRevenue {
  month: string;
  revenue: number;
  invoicedHours: number;
  effectiveRate: number | null;
}

/** Shape of GET /me/dashboard. */
export interface DashboardData {
  today: string;
  todos: Todo[];
  kpis: { scope: "team" | "company"; weeks: WeekKpi[]; revenue: MonthRevenue[] } | null;
}

/** The person's to-do list; each line links to where it is solved. Shows a calm "all done" when empty. */
export function TodoList({ todos }: { todos: Todo[] }) {
  const { t, locale } = useI18n();
  const text = (td: Todo) => {
    const week = td.ref && /^\d{4}-\d{2}-\d{2}$/.test(td.ref) ? isoWeek(td.ref).week : "";
    const month =
      td.ref && td.kind === "close_month" ? fmtDay(td.ref, locale, { month: "long", year: "numeric" }) : "";
    return t(`db.todo.${td.kind}` as MessageKey, { week, month, count: td.count ?? 0, ref: td.ref ?? "" });
  };
  return (
    <Card title={t("db.todos")}>
      {todos.length === 0 ? (
        <p className="text-sm text-ink-700">{t("db.noTodos")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {todos.map((td) => (
            <li key={`${td.kind}-${td.ref ?? ""}`}>
              <Link href={td.href} className="group flex items-center gap-3 py-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${td.severity === "warning" ? "bg-amber-500" : "bg-ink-300"}`}
                />
                <span className="flex-1 first-letter:uppercase text-ink-900 group-hover:underline">
                  {text(td)}
                </span>
                <span className="text-brand-700" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Sums the last `n` weeks into one utilisation / billable figure (basis points). */
function lastWeeks(weeks: WeekKpi[], n: number) {
  const recent = weeks.slice(-n);
  const sum = (k: "norm" | "work" | "billable") => Math.round(recent.reduce((a, w) => a + w[k], 0) * 100);
  return {
    utilisationBp: utilisation(sum("billable"), sum("norm")),
    billableBp: utilisation(sum("billable"), sum("work")),
  };
}

/** Key figures for the team or company: utilisation, billable share, a 12-week trend and (Finance) revenue. */
export function KpiPanel({ kpis }: { kpis: NonNullable<DashboardData["kpis"]> }) {
  const { t, locale } = useI18n();
  const head = lastWeeks(kpis.weeks, 4);
  const max = Math.max(10_000, ...kpis.weeks.map((w) => w.utilisationBp ?? 0));
  const big = "font-[family-name:var(--font-display)] text-3xl tabular-nums text-ink-900";
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-lg font-medium">
        {t(kpis.scope === "company" ? "db.kpis.company" : "db.kpis.team")}
      </h2>
      <div className="grid gap-5 md:grid-cols-3">
        <Card title={t("db.utilisation")}>
          <p className={big}>{fmtPct(head.utilisationBp, locale)}</p>
          <p className="text-xs text-ink-500">{t("db.utilisationHint")}</p>
        </Card>
        <Card title={t("db.billable")}>
          <p className={big}>{fmtPct(head.billableBp, locale)}</p>
          <p className="text-xs text-ink-500">{t("db.billableHint")}</p>
        </Card>
        {kpis.revenue[0] && (
          <Card title={t("db.revenue", { month: fmtDay(kpis.revenue[0].month, locale, { month: "long" }) })}>
            <p className={big}>{fmtKr(kpis.revenue[0].revenue, locale)}</p>
            <p className="text-xs text-ink-500">
              {t("db.effectiveRate", {
                rate:
                  kpis.revenue[0].effectiveRate === null
                    ? "–"
                    : `${fmtKr(kpis.revenue[0].effectiveRate, locale)}/t`,
              })}
            </p>
          </Card>
        )}
      </div>
      <Card title={t("db.trend")}>
        <div className="flex h-36 items-end gap-1.5" role="img" aria-label={t("db.trend")}>
          {kpis.weeks.map((w, i) => {
            const pct = w.utilisationBp === null ? 0 : (w.utilisationBp / max) * 100;
            const last = i === kpis.weeks.length - 1;
            return (
              <div key={w.weekStart} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] tabular-nums text-ink-700">
                  {w.utilisationBp === null ? "–" : `${Math.round(w.utilisationBp / 100)} %`}
                </span>
                <div
                  className={`w-full max-w-8 rounded-t ${last ? "bg-brand-600" : "bg-ink-700"}`}
                  style={{ height: `${Math.max(pct, 1)}%` }}
                  title={`${fmtPct(w.utilisationBp, locale)} · ${w.billable} / ${w.norm} t`}
                />
                <span className="text-[11px] text-ink-500">{isoWeek(w.weekStart).week}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
