"use client";

import { Badge, Button, Card } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { HealthDot, Progress } from "@/components/progress";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api } from "@/lib/api";
import { fmtHours, fmtKr, fmtPct } from "@/lib/format";
import type { ProjectSummary } from "../page";

interface TaskRow {
  id: string;
  parentId: string | null;
  level: number;
  wbs: string;
  name: string;
  billable: boolean;
  status: string;
  isLeaf: boolean;
  budgetHours: number;
  usedHours: number;
  budgetAmount: number;
  usedValue: number;
  hoursConsumptionBp: number | null;
  health: string;
}
interface Contract {
  id: string;
  name: string;
  type: string;
  price: number | null;
  hourlyRate: number | null;
  maxHours: number | null;
  retainerHours: number | null;
  usedHours: number;
  budgetHours: number;
  completionBp: number | null;
  recognisedRevenue: number | null;
}
interface Detail extends ProjectSummary {
  tasks: TaskRow[];
  contracts: Contract[];
  members: { id: string; fullName: string; initials: string }[];
  canEdit: boolean;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ["project", id], queryFn: () => api<Detail>(`/projects/${id}`) });
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addTask = useMutation({
    mutationFn: (body: object) =>
      api(`/projects/${id}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setAdding(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.code : "error"),
  });

  if (p.isLoading || !p.data) return <p className="text-ink-500">{t("common.loading")}</p>;
  const d = p.data;
  const h = (c: number) => fmtHours(c / 100, locale);

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addTask.mutate({
      parentId: adding?.parentId ?? null,
      name: f.get("name"),
      budgetHours: Number(String(f.get("hours") || "0").replace(",", ".")),
      budgetAmount: Number(
        String(f.get("amount") || "0")
          .replace(/\./g, "")
          .replace(",", "."),
      ),
    });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <Link href="/projects" className="text-sm text-ink-500 hover:text-ink-900">
          ← {t("pr.back")}
        </Link>
        <h1 className="mt-2 text-3xl font-normal">
          <span className="text-ink-500">{d.number}</span> {d.name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-700">
          <span>{d.customerName ?? t("pr.internal")}</span>
          <span>·</span>
          <span>
            {t("pr.manager")}: {d.managerName}
          </span>
          <HealthDot health={d.health} label={t(`pr.health.${d.health}` as MessageKey)} />
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label={t("pr.budget")}>
        <Tile label={`${t("pr.budget")} (t)`} value={h(d.budgetHours)} />
        <Tile
          label={`${t("pr.used")} (t)`}
          value={h(d.usedHours)}
          sub={fmtPct(d.hoursConsumptionBp, locale)}
        />
        <Tile label={`${t("pr.remaining")} (t)`} value={h(d.remainingHours)} />
        <Tile
          label={t("pr.value")}
          value={fmtKr(d.usedValue, locale)}
          sub={`${t("pr.budget")} ${fmtKr(d.budgetAmount, locale)}`}
        />
        <Tile
          label={t("pr.margin")}
          value={fmtKr(d.contributionMargin, locale)}
          sub={`${t("pr.marginPct")} ${fmtPct(d.marginBp, locale)}`}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card title={t("pr.wbs")} className="min-w-0">
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("pr.taskName")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("pr.budget")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("pr.used")}
                  </th>
                  <th scope="col" className="w-40 px-3 py-2 font-semibold">
                    %
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("pr.value")}
                  </th>
                  {d.canEdit && (
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">{t("pr.addSubtask")}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {d.tasks.map((task) => (
                  <tr key={task.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2" style={{ paddingLeft: `${1.25 + (task.level - 1) * 1.25}rem` }}>
                      <span className={task.isLeaf ? "text-ink-900" : "font-semibold text-ink-900"}>
                        <span className="mr-2 text-ink-500 tabular-nums">{task.wbs}</span>
                        {task.name}
                      </span>
                      {!task.billable && (
                        <span className="ml-2 text-xs text-ink-500">({t("pr.internal")})</span>
                      )}
                      {task.status === "closed" && <Badge>{t("pr.closed")}</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{h(task.budgetHours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{h(task.usedHours)}</td>
                    <td className="px-3 py-2">
                      <Progress
                        bp={task.hoursConsumptionBp}
                        label={`${task.name} ${fmtPct(task.hoursConsumptionBp, locale)}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {fmtKr(task.usedValue, locale)}
                    </td>
                    {d.canEdit && (
                      <td className="px-3 py-2 text-right">
                        {task.level < 5 && (
                          <button
                            type="button"
                            onClick={() => setAdding({ parentId: task.id })}
                            className="whitespace-nowrap text-xs font-semibold text-ink-500 hover:text-brand-700"
                            aria-label={`${t("pr.addSubtask")}: ${task.name}`}
                          >
                            + {t("pr.subtask")}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.canEdit && !adding && (
            <Button variant="ghost" className="mt-3" onClick={() => setAdding({ parentId: null })}>
              + {t("pr.addTask")}
            </Button>
          )}
          {adding && (
            <form
              onSubmit={onAdd}
              className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-alt p-4 text-sm"
            >
              <label className="flex min-w-60 flex-1 flex-col gap-1">
                <span className="font-semibold text-ink-900">
                  {adding.parentId ? t("pr.addSubtask") : t("pr.addTask")}: {t("pr.taskName")}
                </span>
                <input
                  name="name"
                  required
                  // biome-ignore lint/a11y/noAutofocus: opened by the user's add action
                  autoFocus
                  className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3"
                />
              </label>
              <label className="flex w-32 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("pr.budgetHours")}</span>
                <input
                  name="hours"
                  inputMode="decimal"
                  className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3"
                />
              </label>
              <label className="flex w-36 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("pr.budgetAmount")}</span>
                <input
                  name="amount"
                  inputMode="decimal"
                  className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3"
                />
              </label>
              <Button type="submit" disabled={addTask.isPending}>
                {t("common.save")}
              </Button>
              <Button variant="ghost" onClick={() => setAdding(null)}>
                {t("common.cancel")}
              </Button>
              {error && (
                <p role="alert" className="w-full text-danger">
                  ⚠ {error}
                </p>
              )}
            </form>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card title={t("pr.contracts")}>
            <ul className="flex flex-col gap-4 text-sm">
              {d.contracts.map((c) => (
                <li key={c.id} className="flex flex-col gap-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900">{c.name}</span>
                    <Badge>{t(`pr.type.${c.type}` as MessageKey)}</Badge>
                  </span>
                  {c.price !== null && (
                    <span className="text-ink-700">
                      {t("pr.price")}: {fmtKr(c.price, locale)}
                    </span>
                  )}
                  {c.hourlyRate !== null && (
                    <span className="text-ink-700">
                      {t("pr.rate")}: {fmtKr(c.hourlyRate, locale)}
                    </span>
                  )}
                  {c.maxHours !== null && (
                    <span className="text-ink-700">
                      {t("pr.cap")}: {fmtHours(c.maxHours, locale)} t
                    </span>
                  )}
                  {c.retainerHours !== null && (
                    <span className="text-ink-700">
                      {t("pr.pool")}: {fmtHours(c.retainerHours, locale)} t
                    </span>
                  )}
                  {c.completionBp !== null && (
                    <span className="mt-1 flex flex-col gap-1">
                      <span className="flex justify-between text-ink-700">
                        <span>{t("pr.completion")}</span>
                        <span className="tabular-nums">{fmtPct(c.completionBp, locale)}</span>
                      </span>
                      <Progress bp={c.completionBp} label={t("pr.completion")} />
                      <span className="flex justify-between text-ink-700">
                        <span>{t("pr.recognised")}</span>
                        <span className="font-semibold tabular-nums text-ink-900">
                          {fmtKr(c.recognisedRevenue, locale)}
                        </span>
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t("pr.members")}>
            <ul className="flex flex-wrap gap-2">
              {d.members.map((m) => (
                <li
                  key={m.id}
                  title={m.fullName}
                  className="grid h-8 w-8 place-items-center rounded-full bg-surface-alt text-xs font-semibold text-ink-900"
                >
                  {m.initials}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-1 font-[family-name:var(--font-display)] text-2xl tabular-nums text-ink-900">
        {value}
      </p>
      {sub && <p className="text-xs text-ink-500">{sub}</p>}
    </div>
  );
}
