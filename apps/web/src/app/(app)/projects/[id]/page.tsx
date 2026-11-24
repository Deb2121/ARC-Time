"use client";

import { Badge, Button, Card } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { BillingPlan, type Plan } from "@/components/case-finance/billing-plan";
import { Subconsultants } from "@/components/case-finance/subconsultants";
import { CaseCompletion, PhaseStatusButton } from "@/components/case-lifecycle";
import { MemberPrice, type MemberPriceValue, type RateChoices } from "@/components/member-price";
import { PaymentPlan } from "@/components/payment-plan";
import { HealthDot, healthTip, Progress } from "@/components/progress";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api, can } from "@/lib/api";
import { errorText } from "@/lib/errors";
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
  /** `price` only for those who may change it (manager, Finance, Admin) — D-038 */
  members: { id: string; fullName: string; initials: string; price?: MemberPriceValue | null }[];
  canEdit: boolean;
  rateChoices?: RateChoices;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ["project", id], queryFn: () => api<Detail>(`/projects/${id}`) });
  const me = useMe();
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addTask = useMutation({
    mutationFn: (body: object) =>
      api(`/projects/${id}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setAdding(null);
      setError(null);
      void qc.invalidateQueries({ queryKey: ["project", id] });
      // the billing plan has its own query (phases for the "Fase" dropdown) — refresh it too
      void qc.invalidateQueries({ queryKey: ["case-finance-detail", id] });
    },
    onError: (err) => setError(errorText(err, t)),
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
          {d.status === "completed" && <Badge tone="brand">{t("lc.completedBadge")}</Badge>}
          <span>{d.customerName ?? t("pr.internal")}</span>
          <span>·</span>
          <span>
            {t("pr.manager")}: {d.managerName}
          </span>
          {!d.billable && (
            <span
              className="rounded-full border border-line bg-surface-alt px-2.5 py-0.5 text-xs font-semibold text-ink-700"
              title={t("pr.notBillableHint")}
            >
              {t("pr.notBillable")}
            </span>
          )}
          <HealthDot
            health={d.health}
            label={t(`pr.health.${d.health}` as MessageKey)}
            title={healthTip(d, t, locale)}
          />
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
        <Tile label={t("pr.marginPct")} value={fmtPct(d.marginBp, locale)} />
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-5">
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
                      <td
                        className="px-5 py-2"
                        style={{ paddingLeft: `${1.25 + (task.level - 1) * 1.25}rem` }}
                      >
                        <span className={task.isLeaf ? "text-ink-900" : "font-semibold text-ink-900"}>
                          <span className="mr-2 text-ink-500 tabular-nums">{task.wbs}</span>
                          {task.name}
                        </span>
                        {!task.billable && (
                          <span className="ml-2 text-xs text-ink-500" title={t("pr.notBillableHint")}>
                            · {t("pr.taskNotBillable")}
                          </span>
                        )}
                        {task.status === "closed" && <Badge>{t("pr.closed")}</Badge>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{h(task.budgetHours)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h(task.usedHours)}</td>
                      <td className="px-3 py-2">
                        <Progress
                          bp={task.hoursConsumptionBp}
                          health={task.health}
                          label={`${task.name} ${fmtPct(task.hoursConsumptionBp, locale)}`}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {fmtKr(task.usedValue, locale)}
                      </td>
                      {d.canEdit && (
                        <td className="flex items-center justify-end gap-3 px-3 py-2 text-right">
                          {task.level === 1 && (
                            <PhaseStatusButton
                              caseId={d.id}
                              taskId={task.id}
                              name={task.name}
                              closed={task.status === "closed"}
                            />
                          )}
                          {task.level < 5 && task.status !== "closed" && (
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
          {/* the billing plan sits under the WBS at the same width, so its rows have room (no sideways scroll) */}
          <CasePlans projectId={d.id} contracts={d.contracts} canEdit={d.canEdit} />
          {can(me, "case_finance.view") && d.customerName && (
            <Subconsultants
              caseId={d.id}
              phases={d.tasks}
              fixedFee={d.contracts.some((c) => c.type === "fixed_price")}
            />
          )}
        </div>

        <div className="flex flex-col gap-5">
          {can(me, "project.create") && <CaseCompletion caseId={d.id} />}
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
          <Members
            projectId={d.id}
            members={d.members}
            managerInitials={d.managerInitials}
            canEdit={d.canEdit}
            rateChoices={d.rateChoices}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Faktureringsplan (D-029) for people with case finance access to this case; otherwise the earlier payment plan
 * card (e.g. a project member who is not its project manager).
 */
function CasePlans({
  projectId,
  contracts,
  canEdit,
}: {
  projectId: string;
  contracts: { id: string; name: string; type: string }[];
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const me = useMe();
  const allowed = can(me, "case_finance.view") && contracts.some((c) => c.type !== "time_material");
  const q = useQuery({
    queryKey: ["case-finance-detail", projectId],
    queryFn: () =>
      api<{
        plans: Plan[];
        phases: { id: string; wbs: string; name: string; level: number }[];
        canEdit: boolean;
        canInvoice: boolean;
      }>(`/case-finance/cases/${projectId}`),
    enabled: allowed,
    retry: false,
  });
  if (!allowed || q.isError)
    return <PaymentPlan projectId={projectId} contracts={contracts} canEdit={canEdit} />;
  if (!q.data) return null;
  return (
    <>
      {q.data.plans.map((plan) => (
        <BillingPlan
          key={plan.contractId}
          plan={plan}
          phases={q.data.phases}
          caseId={projectId}
          canEdit={q.data.canEdit}
          canInvoice={q.data.canInvoice}
        />
      ))}
      <Link
        href={`/case-finance/${projectId}`}
        className="text-sm font-semibold text-brand-700 hover:underline"
      >
        {t("nav.caseFinance")} →
      </Link>
    </>
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

interface Person {
  id: string;
  fullName: string;
  initials: string;
  active?: boolean;
  price?: MemberPriceValue | null;
}

/**
 * Projektdeltagere: only members find the project's tasks in Min uge and can book time on them. The project
 * manager (and Admin/Finance) adds and removes people here; the project manager cannot be removed.
 */
function Members({
  projectId,
  members,
  managerInitials,
  canEdit,
  rateChoices,
}: {
  projectId: string;
  members: Person[];
  managerInitials: string | null;
  canEdit: boolean;
  rateChoices?: RateChoices | undefined;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ["users"],
    queryFn: () => api<Person[]>("/users"),
    enabled: canEdit,
  });
  const done = () => {
    setError(null);
    setPick("");
    void qc.invalidateQueries({ queryKey: ["project", projectId] });
    void qc.invalidateQueries({ queryKey: ["case-finance-detail", projectId] });
  };
  const add = useMutation({
    mutationFn: (userId: string) =>
      api(`/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: done,
    onError: (e) => setError(errorText(e, t)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: done,
    onError: (e) => setError(errorText(e, t)),
  });
  const memberIds = new Set(members.map((m) => m.id));
  const candidates = (people.data ?? [])
    .filter((p) => p.active !== false && !memberIds.has(p.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "da"));

  return (
    <Card title={t("pr.members")}>
      <p className="mb-3 text-xs text-ink-500">{t("pr.membersHint")}</p>
      <ul className="flex flex-col gap-1.5">
        {members.map((m) => {
          const isManager = m.initials === managerInitials;
          return (
            <li key={m.id} className="flex items-start gap-2 text-sm">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-alt text-xs font-semibold text-ink-900">
                {m.initials}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
                <span className="text-ink-900">
                  {m.fullName}
                  {isManager && <span className="ml-2 text-xs text-ink-500">{t("pr.manager")}</span>}
                </span>
                {rateChoices?.billable && (
                  <MemberPrice
                    projectId={projectId}
                    userId={m.id}
                    name={m.fullName}
                    price={m.price ?? null}
                    choices={rateChoices}
                    onDone={done}
                  />
                )}
              </span>
              {canEdit && !isManager && (
                <button
                  type="button"
                  onClick={() => remove.mutate(m.id)}
                  disabled={remove.isPending}
                  className="pt-1.5 text-xs font-semibold text-ink-500 hover:text-danger"
                  aria-label={`${t("pr.removeMember")}: ${m.fullName}`}
                >
                  {t("pr.removeMember")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) add.mutate(pick);
          }}
        >
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label={t("pr.addMember")}
            className="h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm"
          >
            <option value="">{t("pr.choosePerson")}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} ({p.initials})
              </option>
            ))}
          </select>
          <Button type="submit" disabled={!pick || add.isPending}>
            {t("pr.addMember")}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
    </Card>
  );
}
