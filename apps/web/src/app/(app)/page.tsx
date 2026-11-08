"use client";

import {
  addDays,
  danishPublicHolidays,
  hasRole,
  isoWeek,
  startOfIsoWeek,
  todayCopenhagen,
} from "@arc-tid/domain";
import { Badge, Card } from "@arc-tid/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMe } from "@/components/session";
import type { WeekData } from "@/components/timesheet/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";
import { fmtDay, fmtFlex, fmtHours } from "@/lib/format";

interface Balances {
  flex: number;
  vacation: { holidayYear: number; accrued: number; used: number; planned: number; balance: number };
}

export default function HomePage() {
  const me = useMe();
  const { t, locale } = useI18n();
  const today = todayCopenhagen();
  const monday = startOfIsoWeek(today);
  const { week, year } = isoWeek(today);
  const isApprover = hasRole(me.roles, "line_manager", "admin", "finance");

  const balances = useQuery({ queryKey: ["balances"], queryFn: () => api<Balances>("/me/balances") });
  const thisWeek = useQuery({
    queryKey: ["week", monday, "me"],
    queryFn: () => api<WeekData>(`/timesheet/week/${monday}`),
  });
  const inbox = useQuery({
    queryKey: ["approvals", addDays(monday, -7)],
    queryFn: () => api<{ items: { status: string }[] }>(`/approvals?weekStart=${addDays(monday, -7)}`),
    enabled: isApprover,
  });
  const pending = inbox.data?.items.filter((i) => i.status === "submitted").length ?? 0;
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
      </header>

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
              {balances.data ? `${n(balances.data.vacation.balance)} ${t("home.days")}` : "…"}
            </p>
            {balances.data && (
              <p className="text-xs text-ink-500">
                {t("home.vacationHint", {
                  year: balances.data.vacation.holidayYear,
                  next: String(balances.data.vacation.holidayYear + 1).slice(2),
                  accrued: n(balances.data.vacation.accrued),
                  used: n(balances.data.vacation.used),
                  planned: n(balances.data.vacation.planned),
                })}
              </p>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {isApprover && (
          <Card title={t("home.toApprove")}>
            <p className="font-[family-name:var(--font-display)] text-3xl tabular-nums text-ink-900">
              {pending}
            </p>
            <Link href="/approval" className="text-sm font-semibold text-brand-700 hover:underline">
              {t("home.toApproveCount", { count: pending })} →
            </Link>
          </Card>
        )}
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
    </div>
  );
}
