"use client";

/**
 * Resource planner (brief §4.8): capacity heatmap per employee per ISO week. Colours follow the brand guide —
 * under-booked cool grey-blue, 70–100 % green, over-booked amber (never brand red). Planners expand a row to edit
 * weekly hours per project; a competence filter and "only free capacity" help find people.
 */
import { addDays, isoWeek, startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import { Button } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useId, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";
import { fmtHours, fmtPct } from "@/lib/format";
import type { ProjectSummary } from "../projects/page";

type Band = "none" | "under" | "ok" | "over";
interface Week {
  weekStart: string;
  capacity: number;
  booked: number;
  free: number;
  utilisationBp: number | null;
  band: Band;
}
interface Person {
  id: string;
  fullName: string;
  initials: string;
  competencies: string[];
  weeks: Week[];
  allocations: {
    projectId: string;
    number: string;
    name: string;
    canEdit: boolean;
    hours: Record<string, number>;
  }[];
  canPlan: boolean;
}
interface Planner {
  weeks: string[];
  people: Person[];
}

/** Cell colours per band (text + background), all AA contrast on white. */
const BAND_STYLE: Record<Band, string> = {
  none: "bg-surface-alt text-ink-500",
  under: "bg-[#e7edf4] text-[#2b4a6b]",
  ok: "bg-[#e2f1e8] text-success",
  over: "bg-[#fcebd7] text-[#8a4600]",
};
const WEEKS = 8;

export default function PlanningPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [from, setFrom] = useState(startOfIsoWeek(todayCopenhagen()));
  const [competence, setCompetence] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const planner = useQuery({
    queryKey: ["planning", from, competence],
    queryFn: () =>
      api<Planner>(
        `/planning?from=${from}&weeks=${WEEKS}${competence ? `&competence=${encodeURIComponent(competence)}` : ""}`,
      ),
  });
  const competencies = useQuery({
    queryKey: ["competencies"],
    queryFn: () => api<string[]>("/planning/competencies"),
  });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const people = useMemo(
    () => (planner.data?.people ?? []).filter((p) => !onlyFree || p.weeks.some((w) => w.free >= 7.5)),
    [planner.data, onlyFree],
  );
  const h = (n: number) => fmtHours(n, locale).replace(/[,.]00$/, "");

  async function save(userId: string, projectId: string, weekStart: string, value: string) {
    const hours = Number(value.replace(",", ".") || "0");
    if (Number.isNaN(hours) || hours < 0 || Math.round(hours * 4) !== hours * 4) {
      setError(t("err.hours_step"));
      return;
    }
    try {
      await api("/planning/allocations", {
        method: "PUT",
        body: JSON.stringify({ userId, projectId, weekStart, hours }),
      });
      setError(null);
      await qc.invalidateQueries({ queryKey: ["planning"] });
    } catch (e) {
      setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error"));
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-normal">{t("pl2.title")}</h1>
          <p className="mt-1 text-ink-700">{t("pl2.intro")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" aria-label={t("pl2.prev")} onClick={() => setFrom(addDays(from, -28))}>
            ←
          </Button>
          <Button variant="secondary" onClick={() => setFrom(startOfIsoWeek(todayCopenhagen()))}>
            {t("pl2.thisWeek")}
          </Button>
          <Button variant="secondary" aria-label={t("pl2.next")} onClick={() => setFrom(addDays(from, 28))}>
            →
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="font-semibold text-ink-900">{t("pl2.competence")}</span>
          <input
            list={listId}
            value={competence}
            onChange={(e) => setCompetence(e.target.value)}
            placeholder={t("pl2.competencePlaceholder")}
            className="h-9 w-56 rounded-[var(--radius-control)] border border-line bg-surface px-3"
          />
          <datalist id={listId}>
            {(competencies.data ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
          {t("pl2.onlyFree")}
        </label>
        <ul className="ml-auto flex flex-wrap gap-3 text-xs" aria-label="Forklaring">
          {(["under", "ok", "over", "none"] as Band[]).map((b) => (
            <li key={b} className="flex items-center gap-1.5">
              <span className={`inline-block h-3 w-5 rounded ${BAND_STYLE[b]}`} aria-hidden="true" />
              {t(`pl2.legend.${b}` as MessageKey)}
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      {planner.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {planner.data && people.length === 0 && <p className="text-ink-500">{t("pl2.empty")}</p>}

      {planner.data && people.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-sm tabular-nums">
            <thead className="border-b border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="w-52 px-4 py-2 text-left font-semibold">
                  {t("pl2.employee")}
                </th>
                {planner.data.weeks.map((w) => (
                  <th key={w} scope="col" className="px-1 py-2 text-center font-semibold">
                    {t("pl2.week", { week: isoWeek(w).week })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const expanded = open.has(p.id);
                const assignable = (projects.data ?? []).filter(
                  (x) => x.customerName && !p.allocations.some((a) => a.projectId === x.id),
                );
                return (
                  <Fragment key={p.id}>
                    <tr className="border-b border-line">
                      <th scope="row" className="px-4 py-2 text-left font-normal">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${p.fullName}: ${t(expanded ? "pl2.hide" : "pl2.show")}`}
                          onClick={() => {
                            const n = new Set(open);
                            if (expanded) n.delete(p.id);
                            else n.add(p.id);
                            setOpen(n);
                          }}
                          className="flex w-full items-center gap-3 text-left"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                            {p.initials}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-ink-900">{p.fullName}</span>
                            <span className="block truncate text-xs text-ink-500">
                              {p.competencies.join(" · ")}
                            </span>
                          </span>
                          <span className="ml-auto text-ink-500" aria-hidden="true">
                            {expanded ? "▾" : "▸"}
                          </span>
                        </button>
                      </th>
                      {p.weeks.map((w) => (
                        <td key={w.weekStart} className="px-1 py-1.5">
                          <div
                            className={`rounded-[var(--radius-control)] px-1 py-1.5 text-center ${BAND_STYLE[w.band]}`}
                            title={`${t("pl2.cell", { booked: h(w.booked), capacity: h(w.capacity) })} · ${t("pl2.free", { free: h(w.free) })}`}
                          >
                            <span className="block font-semibold">
                              {Math.round(w.booked)}/{Math.round(w.capacity)}
                            </span>
                            <span className="block text-[11px]">
                              {w.utilisationBp !== null
                                ? fmtPct(w.utilisationBp, locale).replace(",0", "")
                                : "–"}
                            </span>
                          </div>
                        </td>
                      ))}
                    </tr>
                    {expanded && (
                      <>
                        {p.allocations.map((a) => (
                          <tr key={a.projectId} className="border-b border-line bg-surface-alt/50 text-xs">
                            <td className="py-1.5 pl-16 pr-4 text-ink-700">
                              <span className="text-ink-500">{a.number}</span> {a.name}
                            </td>
                            {planner.data.weeks.map((w) => (
                              <td key={w} className="px-1 py-1 text-center">
                                {a.canEdit ? (
                                  <input
                                    inputMode="decimal"
                                    aria-label={`${p.fullName}, ${a.number} ${a.name}, ${t("pl2.week", { week: isoWeek(w).week })}`}
                                    defaultValue={a.hours[w] ? fmtHours(a.hours[w], locale) : ""}
                                    onBlur={(e) => {
                                      const before = a.hours[w] ?? 0;
                                      const now = Number(e.target.value.replace(",", ".") || "0");
                                      if (now !== before) void save(p.id, a.projectId, w, e.target.value);
                                    }}
                                    className="h-8 w-full max-w-16 rounded-[var(--radius-control)] border border-line bg-surface text-center"
                                  />
                                ) : (
                                  <span>{a.hours[w] ? fmtHours(a.hours[w], locale) : ""}</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {p.canPlan && assignable.length > 0 && (
                          <tr className="border-b border-line bg-surface-alt/50 text-xs">
                            <td className="py-2 pl-16 pr-4" colSpan={1 + planner.data.weeks.length}>
                              <label className="flex items-center gap-2">
                                <span className="font-semibold text-ink-900">{t("pl2.addProject")}</span>
                                <select
                                  className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2"
                                  value=""
                                  onChange={(e) =>
                                    e.target.value && void save(p.id, e.target.value, from, "7.5")
                                  }
                                >
                                  <option value="">{t("pl2.chooseProject")}</option>
                                  {assignable.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.number} {x.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
