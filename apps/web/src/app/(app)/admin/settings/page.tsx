"use client";

import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";
import { fmtDay, fmtHours } from "@/lib/format";

interface Settings {
  year: number;
  normPatterns: { id: string; name: string; days: number[] }[];
  calendars: { id: string; name: string }[];
  holidays: {
    id: string;
    calendarId: string;
    date: string;
    name: string;
    kind: "full" | "half" | "hours";
    hours: number | null;
  }[];
  absenceCodes: {
    id: string;
    code: string;
    nameDa: string;
    nameEn: string;
    countsTowardNorm: boolean;
    approvalRequired: boolean;
    active: boolean;
  }[];
  approvalMode: ApprovalMode;
}
type Tab = "norm" | "holidays" | "absence" | "approval";
type ApprovalMode = "none" | "line_manager" | "pm_then_line_manager";
const MODES: ApprovalMode[] = ["line_manager", "pm_then_line_manager", "none"];

const field = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
const DAYS_DA = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}

function SettingsView() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const tab = (params.get("tab") as Tab) ?? "norm";
  const [year, setYear] = useState(new Date().getFullYear());
  const data = useQuery({
    queryKey: ["settings", year],
    queryFn: () => api<Settings>(`/admin/settings?year=${year}`),
  });
  const [error, setError] = useState<string | null>(null);
  const [addingPattern, setAddingPattern] = useState(false);
  // Shown immediately on click; the server value takes over after the refetch.
  const [modeChoice, setModeChoice] = useState<ApprovalMode | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["settings"] });
  const run = (p: Promise<unknown>) =>
    p
      .then(() => {
        setError(null);
        return refresh();
      })
      .catch((e) => setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error")));
  const days = locale === "da" ? DAYS_DA : DAYS_EN;
  const d = data.data;
  const calendar = d?.calendars[0];

  function addPattern(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const hours = days.map((_, i) => Number(String(f.get(`d${i}`) || "0").replace(",", ".")));
    void run(
      api("/admin/norm-patterns", {
        method: "POST",
        body: JSON.stringify({ name: f.get("name"), days: hours }),
      }),
    ).then(() => setAddingPattern(false));
  }
  function addHoliday(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void run(
      api("/admin/holidays", {
        method: "POST",
        body: JSON.stringify({
          calendarId: calendar?.id,
          date: f.get("date"),
          name: f.get("name"),
          kind: f.get("kind"),
          hours:
            f.get("kind") === "hours" ? Number(String(f.get("hours") || "0").replace(",", ".")) : undefined,
        }),
      }),
    ).then(() => form.reset());
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <h1 className="text-3xl font-normal">{t("set.title")}</h1>
      <div role="tablist" aria-label={t("set.title")} className="flex gap-1 border-b border-line">
        {(["norm", "holidays", "absence", "approval"] as Tab[]).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            onClick={() => router.push(`/admin/settings?tab=${x}`)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === x ? "border-brand-600 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"}`}
          >
            {t(`set.tab.${x}` as MessageKey)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      {!d && <p className="text-ink-500">{t("common.loading")}</p>}

      {d && tab === "approval" && (
        <Card>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-base font-medium">{t("adm.approvalMode")}</legend>
            {MODES.map((m) => (
              <label key={m} className="flex items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="approval-mode"
                  className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]"
                  checked={(modeChoice ?? d.approvalMode) === m}
                  onChange={() => {
                    setModeChoice(m);
                    void run(
                      api("/admin/approval-mode", { method: "PATCH", body: JSON.stringify({ mode: m }) }),
                    ).then(() => setModeChoice(null));
                  }}
                />
                <span className="text-ink-900">{t(`adm.approvalMode.${m}` as MessageKey)}</span>
              </label>
            ))}
            <p className="text-xs text-ink-500">{t("adm.approvalModeHint")}</p>
          </fieldset>
        </Card>
      )}

      {d && tab === "norm" && (
        <Card>
          <p className="mb-4 text-sm text-ink-700">{t("set.normIntro")}</p>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("set.patternName")}
                  </th>
                  {days.map((x) => (
                    <th key={x} scope="col" className="px-2 py-2 text-right font-semibold">
                      {x}
                    </th>
                  ))}
                  <th scope="col" className="px-5 py-2 text-right font-semibold">
                    {t("set.weekTotal")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.normPatterns.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2 font-semibold text-ink-900">{p.name}</td>
                    {p.days.slice(0, 7).map((h, i) => (
                      <td key={days[i]} className="px-2 py-2 text-right">
                        {fmtHours(h / 100, locale, true) || "–"}
                      </td>
                    ))}
                    <td className="px-5 py-2 text-right font-semibold text-ink-900">
                      {fmtHours(p.days.slice(0, 7).reduce((a, b) => a + b, 0) / 100, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!addingPattern ? (
            <Button variant="ghost" className="mt-3" onClick={() => setAddingPattern(true)}>
              + {t("set.addPattern")}
            </Button>
          ) : (
            <form
              onSubmit={addPattern}
              className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-surface-alt p-4 text-sm"
            >
              <label className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("set.patternName")}</span>
                <input name="name" required className={field} />
              </label>
              {days.map((x, i) => (
                <label key={x} className="flex w-14 flex-col gap-1">
                  <span className="font-semibold text-ink-900">{x}</span>
                  <input
                    name={`d${i}`}
                    inputMode="decimal"
                    defaultValue={i < 4 ? "7,5" : i === 4 ? "7" : "0"}
                    className={`${field} text-right`}
                  />
                </label>
              ))}
              <Button type="submit">{t("common.save")}</Button>
              <Button variant="ghost" onClick={() => setAddingPattern(false)}>
                {t("common.cancel")}
              </Button>
            </form>
          )}
        </Card>
      )}

      {d && tab === "holidays" && calendar && (
        <Card>
          <p className="mb-4 text-sm text-ink-700">{t("set.holidayIntro")}</p>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-ink-900">{t("set.year")}</span>
              <select className={field} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[year - 1, year, year + 1, year + 2].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              onClick={() =>
                run(
                  api(`/admin/holiday-calendars/${calendar.id}/generate`, {
                    method: "POST",
                    body: JSON.stringify({ year }),
                  }),
                )
              }
            >
              {t("set.generate", { year })}
            </Button>
          </div>
          {d.holidays.length === 0 && <p className="text-sm text-ink-500">{t("set.noHolidays")}</p>}
          <ul className="flex flex-col divide-y divide-line text-sm">
            {d.holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                <span className="w-44 first-letter:uppercase text-ink-700">
                  {fmtDay(h.date, locale, { weekday: "long", day: "numeric", month: "long" })}
                </span>
                <span className="flex-1 font-semibold text-ink-900">{h.name}</span>
                <Badge>
                  {h.kind === "hours"
                    ? `${fmtHours(h.hours ?? 0, locale)} t`
                    : t(`set.kind.${h.kind}` as MessageKey)}
                </Badge>
                <button
                  type="button"
                  className="text-xs font-semibold text-ink-500 hover:text-danger"
                  onClick={() => run(api(`/admin/holidays/${h.id}`, { method: "DELETE" }))}
                >
                  {t("pl.delete")}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={addHoliday}
            className="mt-4 flex flex-wrap items-end gap-2 rounded-lg bg-surface-alt p-4 text-sm"
          >
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("set.date")}</span>
              <input name="date" type="date" required className={field} />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("set.name")}</span>
              <input name="name" required className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("ap.status")}</span>
              <select name="kind" className={field} defaultValue="full">
                {(["full", "half", "hours"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`set.kind.${k}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-20 flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("common.hours")}</span>
              <input name="hours" inputMode="decimal" className={field} />
            </label>
            <Button type="submit">{t("set.addHoliday")}</Button>
          </form>
        </Card>
      )}

      {d && tab === "absence" && (
        <Card>
          <p className="mb-4 text-sm text-ink-700">{t("set.absenceIntro")}</p>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("set.code")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("set.name")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-center font-semibold">
                    {t("set.countsNorm")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-center font-semibold">
                    {t("set.needsApproval")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-center font-semibold">
                    {t("set.active")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.absenceCodes.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2 font-semibold text-ink-900">{c.code}</td>
                    <td className="px-3 py-2">{locale === "da" ? c.nameDa : c.nameEn}</td>
                    {(["countsTowardNorm", "approvalRequired", "active"] as const).map((f) => (
                      <td key={f} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${c.code}: ${t(f === "countsTowardNorm" ? "set.countsNorm" : f === "approvalRequired" ? "set.needsApproval" : "set.active")}`}
                          checked={c[f]}
                          onChange={(e) =>
                            run(
                              api(`/admin/absence-codes/${c.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ [f]: e.target.checked }),
                              }),
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
