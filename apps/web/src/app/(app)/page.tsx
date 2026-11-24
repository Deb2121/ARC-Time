"use client";

import { danishPublicHolidays, isoWeek, startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { type DashboardData, KpiPanel, TodoList } from "@/components/dashboard";
import { useMe } from "@/components/session";
import type { WeekData } from "@/components/timesheet/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";
import { fmtDay, fmtFlex, fmtHours } from "@/lib/format";

interface LeaveDays {
  earned: number;
  used: number;
  pending: number;
  balance: number;
}
interface Balances {
  flex: number;
  vacation: LeaveDays | null;
  extraHoliday: LeaveDays | null;
}

export default function HomePage() {
  const me = useMe();
  const { t, locale } = useI18n();
  const [hello, setHello] = useState(false);
  const today = todayCopenhagen();
  const monday = startOfIsoWeek(today);
  const { week, year } = isoWeek(today);

  const balances = useQuery({ queryKey: ["balances"], queryFn: () => api<Balances>("/me/balances") });
  const thisWeek = useQuery({
    queryKey: ["week", monday, "me"],
    queryFn: () => api<WeekData>(`/timesheet/week/${monday}`),
  });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("/me/dashboard") });
  const nextHoliday = [...danishPublicHolidays(year), ...danishPublicHolidays(year + 1)].find(
    (h) => h.date >= today,
  );
  const n = (v: number) => fmtHours(v, locale).replace(/[,.]00$/, "");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header>
        <p className="text-sm first-letter:uppercase text-ink-500">
          {fmtDay(today, locale, { weekday: "long", day: "numeric", month: "long" })} ·{" "}
          {locale === "da" ? "uge" : "week"} {week}
        </p>
        <h1 className="mt-1 text-3xl font-normal">
          {t("home.greeting", { name: me.fullName.split(" ")[0] ?? "" })}
        </h1>
        <p className="mt-2 text-ink-700">{t("home.intro")}</p>
        {me.roles.includes("admin") && (
          <div className="mt-3 flex items-center gap-3">
            <Button variant="secondary" onClick={() => setHello((v) => !v)}>
              {t("home.helloButton")}
            </Button>
            {hello && (
              <span role="status" className="text-ink-900">
                {t("home.helloMessage", { name: me.fullName.split(" ")[0] ?? "" })}
              </span>
            )}
          </div>
        )}
      </header>

      {dash.data && <TodoList todos={dash.data.todos} />}

      <div className="grid gap-5 md:grid-cols-3">
        <Card title={t("home.week")} className="md:col-span-2">
          {thisWeek.data ? (
            <>
              <div className="grid grid-cols-7 gap-2 text-center text-xs">
                {thisWeek.data.days.map((d) => {
                  const registered = thisWeek.data.rows.reduce(
                    (a, r) => a + (r.cells[d.date]?.hours ?? 0),
                    0,
                  );
                  const pct =
                    d.norm > 0 ? Math.min(100, (registered / d.norm) * 100) : registered > 0 ? 100 : 0;
                  return (
                    <div key={d.date} className="flex flex-col items-center gap-1">
                      <span className="first-letter:uppercase text-ink-500">
                        {fmtDay(d.date, locale, { weekday: "short" })}
                      </span>
                      <div
                        className="relative h-16 w-full max-w-10 overflow-hidden rounded bg-surface-alt"
                        aria-hidden="true"
                      >
                        <div
                          className={`absolute bottom-0 w-full ${d.date === today ? "bg-brand-600" : "bg-ink-700"}`}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-ink-900">
                        {fmtHours(registered, locale, true) || "–"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
                <span className="text-ink-700">
                  {fmtHours(thisWeek.data.summary.work + thisWeek.data.summary.absence, locale)} /{" "}
                  {fmtHours(thisWeek.data.summary.norm, locale)} t ·{" "}
                  <Badge>{t(`ts.status.${thisWeek.data.status}` as MessageKey)}</Badge>
                </span>
                <Link href="/timesheet" className="font-semibold text-brand-700 hover:underline">
                  {t("home.openWeek")} →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-ink-500">{t("common.loading")}</p>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card title={t("home.flex")}>
            <p className="font-[family-name:var(--font-display)] text-3xl tabular-nums text-ink-900">
              {balances.data ? `${fmtFlex(balances.data.flex, locale)} t` : "…"}
            </p>
            <p className="text-xs text-ink-500">{t("home.flexHint")}</p>
          </Card>
          <Card title={t("home.vacation")}>
            <p className="font-[family-name:var(--font-display)] text-3xl tabular-nums text-ink-900">
              {balances.data?.vacation ? `${n(balances.data.vacation.balance)} ${t("home.days")}` : "…"}
            </p>
            {balances.data?.vacation && (
              <p className="text-xs text-ink-500">
                {t("home.vacationHint", {
                  accrued: n(balances.data.vacation.earned),
                  used: n(balances.data.vacation.used),
                  planned: n(balances.data.vacation.pending),
                })}
              </p>
            )}
            {balances.data?.extraHoliday && (
              <p className="mt-1 text-xs text-ink-700">
                {t("home.extraHoliday", { days: n(balances.data.extraHoliday.balance) })}
              </p>
            )}
            <Link
              href="/leave"
              className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline"
            >
              {t("lv.open")} →
            </Link>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Card title={t("home.roles")}>
          <ul className="flex flex-wrap gap-2">
            {me.roles.map((r) => (
              <li key={r}>
                <Badge tone={r === "employee" ? "neutral" : "brand"}>{t(`role.${r}` as MessageKey)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        {nextHoliday && (
          <Card title={t("home.nextHoliday")}>
            <p className="font-semibold text-ink-900">{nextHoliday.nameDa}</p>
            <p className="text-sm first-letter:uppercase text-ink-700">
              {fmtDay(nextHoliday.date, locale, { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </Card>
        )}
      </div>

      {dash.data?.kpis && <KpiPanel kpis={dash.data.kpis} />}
    </div>
  );
}
