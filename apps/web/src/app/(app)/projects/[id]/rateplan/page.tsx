"use client";

/**
 * Rateplan-generator for a fixed-price case (D-039), modelled on Finance's Excel sheet: fee per phase (+ fee parts
 * distributed over phases), sub-consultants (fixed per phase or by share) and an instalment pattern per phase. The
 * plan is computed live with the same pure function as the server (computeFeePlan), saved, exported to Excel and —
 * on request — written as a DRAFT billing plan (never over an active or invoiced plan).
 */
import { computeFeePlan, type FeePlanInput, type FeePlanProblem, type FeePlanResult } from "@arc-tid/domain";
import { Button, Card } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ExportButtons } from "@/components/export-buttons";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtKr } from "@/lib/format";

interface Generator {
  contract: { id: string; name: string; price: number; planActive: boolean; planItems: number };
  project: { id: string; number: string; name: string };
  tasks: { id: string; name: string; budgetAmount: number }[];
  saved: boolean;
  input: FeePlanInput;
  canEdit: boolean;
  blockedBy: "plan_active" | "plan_item_invoiced" | null;
}

interface PhaseRow {
  key: string;
  name: string;
  taskId: string | null;
  base: string;
  start: string;
  pattern: string;
}
interface PoolRow {
  name: string;
  amount: string;
  keys: string[];
}
interface SubRow {
  name: string;
  mode: "fixed" | "share";
  total: string;
  perPhase: Record<string, string>;
}

const field = "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
/** "1.150.000,50" → 115000050 øre; empty → 0; anything else → NaN (shown as a problem) */
const toOre = (s: string) => {
  const v = s.trim();
  if (!v) return 0;
  const n = Number(v.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
};
const fromOre = (o: number) => (o ? String(o / 100).replace(".", ",") : "");
/** "1-2-2-2-2-1", "2 1", "1;1;1" → weights; a bad part becomes NaN (shown as a problem) */
const toWeights = (s: string) =>
  s
    .split(/[\s;/-]+/)
    .filter(Boolean)
    .map((x) => Number(x.replace(",", ".")));

export default function RateplanPage() {
  return (
    <Suspense>
      <RateplanGenerator />
    </Suspense>
  );
}

function RateplanGenerator() {
  const { id } = useParams<{ id: string }>();
  const contractId = useSearchParams().get("contract") ?? "";
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["fee-plan", contractId],
    queryFn: () => api<Generator>(`/case-finance/contracts/${contractId}/fee-plan`),
    enabled: Boolean(contractId),
    retry: false,
  });
  if (q.isError) return <p className="text-danger">⚠ {errorText(q.error, t)}</p>;
  if (!q.data) return <p className="text-ink-500">{t("common.loading")}</p>;
  return <Editor key={String(q.dataUpdatedAt)} g={q.data} caseId={id} />;
}

function Editor({ g, caseId }: { g: Generator; caseId: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const [phases, setPhases] = useState<PhaseRow[]>(() =>
    g.input.phases.map((p) => ({
      key: p.key,
      name: p.name,
      taskId: p.taskId ?? null,
      base: fromOre(p.baseFee),
      start: p.start,
      pattern: p.weights.join("-"),
    })),
  );
  const [pools, setPools] = useState<PoolRow[]>(() =>
    g.input.pools.map((p) => ({ name: p.name, amount: fromOre(p.amount), keys: p.phaseKeys })),
  );
  const [subs, setSubs] = useState<SubRow[]>(() =>
    g.input.subs.map((s) => ({
      name: s.name,
      mode: s.mode,
      total: fromOre(s.total ?? 0),
      perPhase: Object.fromEntries(Object.entries(s.perPhase ?? {}).map(([k, v]) => [k, fromOre(v)])),
    })),
  );
  const [dirty, setDirty] = useState(!g.saved);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const touch = () => {
    setDirty(true);
    setMsg(null);
    setConfirm(false);
  };
  const kr = (o: number) => (Number.isFinite(o) ? fmtKr(o, locale, 2) : "–");

  const input: FeePlanInput = useMemo(
    () => ({
      phases: phases.map((p) => ({
        key: p.key,
        name: p.name.trim() || "?",
        baseFee: toOre(p.base),
        taskId: p.taskId,
        start: p.start,
        weights: toWeights(p.pattern),
      })),
      pools: pools.map((p) => ({ name: p.name.trim() || "?", amount: toOre(p.amount), phaseKeys: p.keys })),
      subs: subs.map((s) => ({
        name: s.name.trim() || "?",
        mode: s.mode,
        ...(s.mode === "share"
          ? { total: toOre(s.total) }
          : { perPhase: Object.fromEntries(phases.map((p) => [p.key, toOre(s.perPhase[p.key] ?? "")])) }),
      })),
    }),
    [phases, pools, subs],
  );
  const result = useMemo(() => computeFeePlan(input), [input]);
  const mismatch = result.total !== g.contract.price;

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      api(`/case-finance/contracts/${g.contract.id}/fee-plan`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setDirty(false);
      setMsg({ ok: true, text: t("fp.saved") });
      void qc.invalidateQueries({ queryKey: ["fee-plan", g.contract.id] });
    },
    onError: (e) => setMsg({ ok: false, text: errorText(e, t) }),
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (dirty)
        await api(`/case-finance/contracts/${g.contract.id}/fee-plan`, {
          method: "PUT",
          body: JSON.stringify(input),
        });
      return api(`/case-finance/contracts/${g.contract.id}/fee-plan/apply`, { method: "POST" });
    },
    onSuccess: () => {
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["case-finance-detail", caseId] });
      router.push(`/projects/${caseId}`);
    },
    onError: (e) => {
      setConfirm(false);
      setMsg({ ok: false, text: errorText(e, t) });
    },
  });

  const addPhase = () => {
    touch();
    setPhases((xs) => [
      ...xs,
      {
        key: `fase-${Date.now()}`,
        name: "",
        taskId: null,
        base: "",
        start: xs.at(-1)?.start ?? new Date().toISOString().slice(0, 7),
        pattern: "1",
      },
    ]);
  };
  const usedTasks = new Set(phases.map((p) => p.taskId).filter(Boolean));
  const ro = !g.canEdit;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <Link href={`/projects/${caseId}`} className="text-sm text-ink-500 hover:text-ink-900">
          ← {g.project.number} {g.project.name}
        </Link>
        <h1 className="mt-2 text-3xl font-normal">{t("fp.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-700">{t("fp.intro")}</p>
        <p className="mt-2 text-sm text-ink-700">
          {g.contract.name} · {t("fp.contractPrice")}:{" "}
          <span className="font-semibold tabular-nums">{kr(g.contract.price)}</span>
        </p>
      </header>

      {/* 1. phases */}
      <Card title={`1. ${t("fp.phases")}`}>
        <p className="mb-3 text-xs text-ink-500">{t("fp.phasesHint")}</p>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-2 text-left font-semibold">{t("fp.phase")}</th>
                <th className="w-40 px-2 py-2 text-left font-semibold">{t("fp.ownFee")}</th>
                <th className="w-40 px-2 py-2 text-left font-semibold">{t("fp.start")}</th>
                <th className="w-44 px-2 py-2 text-left font-semibold">{t("fp.pattern")}</th>
                <th className="w-36 px-2 py-2 text-right font-semibold">{t("fp.phaseTotal")}</th>
                <th className="w-16 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {phases.map((p, i) => {
                const r = result.phases[i];
                const set = (patch: Partial<PhaseRow>) => {
                  touch();
                  setPhases((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                };
                return (
                  <tr key={p.key} className="border-b border-line last:border-0">
                    <td className="px-5 py-2">
                      <input
                        value={p.name}
                        onChange={(e) => set({ name: e.target.value })}
                        className={field}
                        disabled={ro}
                        aria-label={t("fp.phase")}
                      />
                      {!p.taskId && <span className="text-xs text-ink-500">{t("fp.noTask")}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={p.base}
                        onChange={(e) => set({ base: e.target.value })}
                        inputMode="decimal"
                        className={`${field} text-right tabular-nums`}
                        disabled={ro}
                        aria-label={`${t("fp.ownFee")}: ${p.name}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="month"
                        value={p.start}
                        onChange={(e) => set({ start: e.target.value })}
                        className={field}
                        disabled={ro}
                        aria-label={`${t("fp.start")}: ${p.name}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={p.pattern}
                        onChange={(e) => set({ pattern: e.target.value })}
                        className={`${field} tabular-nums`}
                        placeholder="1-1-1"
                        disabled={ro}
                        aria-label={`${t("fp.pattern")}: ${p.name}`}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {r ? kr(r.total) : "–"}
                      {r && (
                        <span className="block text-xs text-ink-500">
                          {(r.shareBp / 100).toFixed(1).replace(".", ",")} %
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!ro && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-ink-500 hover:text-danger"
                          onClick={() => {
                            touch();
                            setPhases((xs) => xs.filter((_, j) => j !== i));
                            setPools((xs) =>
                              xs.map((x) => ({ ...x, keys: x.keys.filter((k) => k !== p.key) })),
                            );
                          }}
                        >
                          {t("pr.removeMember")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!ro && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={addPhase}>
              + {t("fp.addPhase")}
            </Button>
            {g.tasks
              .filter((x) => !usedTasks.has(x.id))
              .map((x) => (
                <Button
                  key={x.id}
                  variant="ghost"
                  onClick={() => {
                    touch();
                    setPhases((xs) => [
                      ...xs,
                      {
                        key: x.id,
                        name: x.name,
                        taskId: x.id,
                        base: fromOre(x.budgetAmount),
                        start: xs.at(-1)?.start ?? new Date().toISOString().slice(0, 7),
                        pattern: "1",
                      },
                    ]);
                  }}
                >
                  + {x.name}
                </Button>
              ))}
          </div>
        )}
        <p className="mt-2 text-xs text-ink-500">{t("fp.patternHint")}</p>
      </Card>

      {/* 2. fee parts to distribute */}
      <Card title={`2. ${t("fp.pools")}`}>
        <p className="mb-3 text-xs text-ink-500">{t("fp.poolsHint")}</p>
        <div className="flex flex-col gap-3">
          {pools.map((pool, i) => {
            const set = (patch: Partial<PoolRow>) => {
              touch();
              setPools((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            };
            return (
              <div key={`pool-${i.toString()}`} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-60 flex-1 flex-col gap-1">
                    <span className="text-xs font-semibold text-ink-900">{t("fp.poolName")}</span>
                    <input
                      value={pool.name}
                      onChange={(e) => set({ name: e.target.value })}
                      className={field}
                      disabled={ro}
                    />
                  </label>
                  <label className="flex w-44 flex-col gap-1">
                    <span className="text-xs font-semibold text-ink-900">{t("fp.amount")}</span>
                    <input
                      value={pool.amount}
                      onChange={(e) => set({ amount: e.target.value })}
                      inputMode="decimal"
                      className={`${field} text-right tabular-nums`}
                      disabled={ro}
                    />
                  </label>
                  {!ro && (
                    <button
                      type="button"
                      className="h-9 text-xs font-semibold text-ink-500 hover:text-danger"
                      onClick={() => {
                        touch();
                        setPools((xs) => xs.filter((_, j) => j !== i));
                      }}
                    >
                      {t("pr.removeMember")}
                    </button>
                  )}
                </div>
                <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <legend className="mb-1 text-xs text-ink-500">{t("fp.poolPhases")}</legend>
                  {phases.map((p) => (
                    <label key={p.key} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={pool.keys.includes(p.key)}
                        disabled={ro}
                        onChange={(e) =>
                          set({
                            keys: e.target.checked
                              ? [...pool.keys, p.key]
                              : pool.keys.filter((k) => k !== p.key),
                          })
                        }
                      />
                      {p.name || "?"}
                    </label>
                  ))}
                </fieldset>
              </div>
            );
          })}
        </div>
        {!ro && (
          <Button
            variant="ghost"
            className="mt-3"
            onClick={() => {
              touch();
              setPools((xs) => [...xs, { name: "", amount: "", keys: [] }]);
            }}
          >
            + {t("fp.addPool")}
          </Button>
        )}
      </Card>

      {/* 3. sub-consultants */}
      <Card title={`3. ${t("fp.subs")}`}>
        <p className="mb-3 text-xs text-ink-500">{t("fp.subsHint")}</p>
        <div className="flex flex-col gap-3">
          {subs.map((s, i) => {
            const set = (patch: Partial<SubRow>) => {
              touch();
              setSubs((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            };
            return (
              <div key={`sub-${i.toString()}`} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-60 flex-1 flex-col gap-1">
                    <span className="text-xs font-semibold text-ink-900">{t("fp.subName")}</span>
                    <input
                      value={s.name}
                      onChange={(e) => set({ name: e.target.value })}
                      className={field}
                      disabled={ro}
                    />
                  </label>
                  <label className="flex w-64 flex-col gap-1">
                    <span className="text-xs font-semibold text-ink-900">{t("fp.subMode")}</span>
                    <select
                      value={s.mode}
                      onChange={(e) => set({ mode: e.target.value as SubRow["mode"] })}
                      className={field}
                      disabled={ro}
                    >
                      <option value="fixed">{t("fp.subFixed")}</option>
                      <option value="share">{t("fp.subShare")}</option>
                    </select>
                  </label>
                  {s.mode === "share" && (
                    <label className="flex w-44 flex-col gap-1">
                      <span className="text-xs font-semibold text-ink-900">{t("fp.subTotal")}</span>
                      <input
                        value={s.total}
                        onChange={(e) => set({ total: e.target.value })}
                        inputMode="decimal"
                        className={`${field} text-right tabular-nums`}
                        disabled={ro}
                      />
                    </label>
                  )}
                  {!ro && (
                    <button
                      type="button"
                      className="h-9 text-xs font-semibold text-ink-500 hover:text-danger"
                      onClick={() => {
                        touch();
                        setSubs((xs) => xs.filter((_, j) => j !== i));
                      }}
                    >
                      {t("pr.removeMember")}
                    </button>
                  )}
                </div>
                {s.mode === "fixed" && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {phases.map((p) => (
                      <label key={p.key} className="flex flex-col gap-1">
                        <span className="truncate text-xs text-ink-500">{p.name || "?"}</span>
                        <input
                          value={s.perPhase[p.key] ?? ""}
                          onChange={(e) => set({ perPhase: { ...s.perPhase, [p.key]: e.target.value } })}
                          inputMode="decimal"
                          className={`${field} text-right tabular-nums`}
                          disabled={ro}
                        />
                      </label>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-ink-500">
                  {t("fp.subSum")}:{" "}
                  <span className="font-semibold tabular-nums">{kr(result.subTotals[i] ?? 0)}</span>
                </p>
              </div>
            );
          })}
        </div>
        {!ro && (
          <Button
            variant="ghost"
            className="mt-3"
            onClick={() => {
              touch();
              setSubs((xs) => [...xs, { name: "", mode: "fixed", total: "", perPhase: {} }]);
            }}
          >
            + {t("fp.addSub")}
          </Button>
        )}
      </Card>

      {/* 4. the generated plan */}
      <Card title={`4. ${t("fp.result")}`}>
        <Checks problems={result.problems} mismatch={mismatch} result={result} price={g.contract.price} />
        <ResultTable result={result} subs={input.subs.map((s) => s.name)} />
        <p className="mt-2 text-xs text-ink-500">{t("fp.sameMonth")}</p>

        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
          {!ro && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
                {t("fp.save")}
              </Button>
              {!confirm ? (
                <Button
                  variant="secondary"
                  onClick={() => setConfirm(true)}
                  disabled={Boolean(g.blockedBy) || result.problems.length > 0 || !result.instalments.length}
                >
                  {t("fp.apply")}
                </Button>
              ) : (
                <span className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-alt px-3 py-2 text-sm">
                  {g.contract.planItems > 0 ? t("fp.confirmReplace") : t("fp.confirmNew")}
                  <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
                    {t("fp.applyYes", { count: result.instalments.length })}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    {t("common.cancel")}
                  </Button>
                </span>
              )}
              {dirty && <span className="text-xs text-ink-500">{t("fp.unsaved")}</span>}
            </div>
          )}
          {g.blockedBy && (
            <p className="text-sm text-ink-700">{t(`fp.blocked.${g.blockedBy}` as MessageKey)}</p>
          )}
          {msg && (
            <p
              role={msg.ok ? "status" : "alert"}
              className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}
            >
              {msg.ok ? "✓" : "⚠"} {msg.text}
            </p>
          )}
          {g.saved && (
            <ExportButtons
              href={(f) =>
                `${API_URL}/api/v1/case-finance/contracts/${g.contract.id}/fee-plan/export?format=${f}`
              }
              hint="fp.exportHint"
            />
          )}
        </div>
      </Card>
    </div>
  );
}

function Checks({
  problems,
  mismatch,
  result,
  price,
}: {
  problems: FeePlanProblem[];
  mismatch: boolean;
  result: FeePlanResult;
  price: number;
}) {
  const { t, locale } = useI18n();
  const text = (p: FeePlanProblem) => {
    const k = `fp.problem.${p.code}` as MessageKey;
    return t(k, {
      where: "where" in p ? p.where : "",
      phase: "phase" in p ? p.phase : "",
      pool: "pool" in p ? p.pool : "",
      sub: "sub" in p ? p.sub : "",
    });
  };
  if (!problems.length && !mismatch)
    return (
      <p className="mb-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-ink-900">
        ✓ {t("fp.ok", { count: result.instalments.length, total: fmtKr(result.total, locale, 2) })}
      </p>
    );
  return (
    <ul className="mb-3 flex flex-col gap-1 rounded-lg bg-danger/10 px-3 py-2 text-sm text-ink-900">
      {problems.map((p, i) => (
        <li key={`${p.code}-${i.toString()}`}>⚠ {text(p)}</li>
      ))}
      {mismatch && (
        <li>
          ⚠{" "}
          {t("fp.priceMismatch", {
            plan: Number.isFinite(result.total) ? fmtKr(result.total, locale, 2) : "–",
            price: fmtKr(price, locale, 2),
          })}
        </li>
      )}
    </ul>
  );
}

const MONTHS_DA = [
  "jan.",
  "feb.",
  "mar.",
  "apr.",
  "maj",
  "jun.",
  "jul.",
  "aug.",
  "sep.",
  "okt.",
  "nov.",
  "dec.",
];

function ResultTable({ result, subs }: { result: FeePlanResult; subs: string[] }) {
  const { t, locale } = useI18n();
  const kr = (o: number) => (Number.isFinite(o) ? fmtKr(o, locale, 2) : "–");
  const month = (d: string) => `${MONTHS_DA[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const cell = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-5 py-2 text-left font-semibold">{t("fp.phaseRate")}</th>
            <th className="px-3 py-2 text-left font-semibold">{t("fp.month")}</th>
            <th className="px-3 py-2 text-right font-semibold">{t("fp.amount")}</th>
            <th className="px-3 py-2 text-right font-semibold">ARCnordic</th>
            {subs.map((s, j) => (
              <th key={`h-${j.toString()}`} className="px-3 py-2 text-right font-semibold normal-case">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.phases.map((p) => (
            <PhaseRows key={p.key} p={p} result={result} cell={cell} kr={kr} month={month} />
          ))}
          <tr className="border-t-2 border-ink-300 font-semibold">
            <td className="px-5 py-2">{t("fp.control")}</td>
            <td />
            <td className={cell}>{kr(result.instalments.reduce((a, i) => a + i.amount, 0))}</td>
            <td className={cell}>{kr(result.own)}</td>
            {result.subTotals.map((s, j) => (
              <td key={`t-${j.toString()}`} className={cell}>
                {kr(s)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PhaseRows({
  p,
  result,
  cell,
  kr,
  month,
}: {
  p: FeePlanResult["phases"][number];
  result: FeePlanResult;
  cell: string;
  kr: (o: number) => string;
  month: (d: string) => string;
}) {
  const own = result.instalments.filter((i) => i.phaseKey === p.key);
  const sameMonth = (d: string) => result.instalments.filter((i) => i.date === d).length > 1;
  return (
    <>
      <tr className="border-t border-line bg-surface-alt/60 font-semibold text-ink-900">
        <td className="px-5 py-1.5">{p.name}</td>
        <td className="px-3 py-1.5 text-xs font-normal text-ink-500">
          {(p.shareBp / 100).toFixed(1).replace(".", ",")} %
        </td>
        <td className={cell}>{kr(p.total)}</td>
        <td className={cell}>{kr(p.own)}</td>
        {p.subAmounts.map((s, j) => (
          <td key={`ps-${j.toString()}`} className={cell}>
            {kr(s)}
          </td>
        ))}
      </tr>
      {own.map((i) => (
        <tr key={i.sequence} className="text-ink-700">
          <td className="py-1.5 pr-3 pl-9">Rate {i.sequence}</td>
          <td className="px-3 py-1.5 whitespace-nowrap">
            {month(i.date)}
            {sameMonth(i.date) && <span className="ml-1 text-xs text-ink-500">*</span>}
          </td>
          <td className={cell}>{kr(i.amount)}</td>
          <td className={cell}>{kr(i.own)}</td>
          {i.subAmounts.map((s, j) => (
            <td key={`is-${j.toString()}`} className={cell}>
              {kr(s)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
