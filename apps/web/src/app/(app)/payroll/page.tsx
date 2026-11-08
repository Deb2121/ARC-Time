"use client";

/**
 * Payroll export ("Lønoverførsel", docs/spec/payroll.md, D-023) for Finance: pick a month, see what each employee
 * gets on which salary code (with warnings), generate the file, download it and lock the month. A second tab sets
 * provider codes and which absence code feeds which salary code. Data: /payroll/* (apps/api/src/routes/payroll.ts).
 */
import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, ApiError, api } from "@/lib/api";
import { fmtDay, fmtHours, fmtKr } from "@/lib/format";

interface PayPeriod {
  id: string;
  month: string;
  status: "open" | "exported" | "locked";
  exportedAt: string | null;
}
interface Line {
  code: string;
  name: string;
  unit: "hours" | "days" | "km" | "amount";
  quantity: number;
  amount: number | null;
  originalPeriod: string | null;
  sourceCount: number;
}
interface Preview {
  period: PayPeriod;
  run: { id: string; createdAt: string; lineCount: number } | null;
  rows: {
    userId: string;
    fullName: string;
    payrollNumber: string | null;
    unapproved: number;
    lines: Line[];
  }[];
}
interface Setup {
  codes: {
    id: string;
    code: string;
    name: string;
    unit: string;
    kind: string;
    providerCode: string | null;
    includeInExport: boolean;
  }[];
  absenceCodes: { id: string; code: string; nameDa: string; nameEn: string; salaryCodeId: string | null }[];
}

const field = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";

export default function PayrollPage() {
  return (
    <Suspense>
      <Payroll />
    </Suspense>
  );
}

function Payroll() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "codes" ? "codes" : "export";
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("pay.title")}</h1>
        <p className="mt-1 text-ink-700">{t("pay.intro")}</p>
      </header>
      <div role="tablist" aria-label={t("pay.title")} className="flex gap-1 border-b border-line">
        {(["export", "codes"] as const).map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            aria-selected={tab === x}
            onClick={() => router.push(x === "codes" ? "/payroll?tab=codes" : "/payroll")}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === x ? "border-brand-600 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"}`}
          >
            {t(x === "codes" ? "pay.tab.codes" : "pay.tab.export")}
          </button>
        ))}
      </div>
      {tab === "codes" ? <SalaryCodes /> : <ExportView />}
    </div>
  );
}

/** Month list + preview + export/lock actions. */
function ExportView() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const periods = useQuery({
    queryKey: ["pay-periods"],
    queryFn: () => api<PayPeriod[]>("/payroll/periods"),
  });
  const [chosen, setChosen] = useState<string | null>(null);
  // Default: the earliest month that is not locked yet (the one payroll is working on).
  const month =
    chosen ?? periods.data?.find((p) => p.status !== "locked")?.month ?? periods.data?.at(-1)?.month ?? null;
  const preview = useQuery({
    queryKey: ["pay-preview", month],
    queryFn: () => api<Preview>(`/payroll/periods/${month}`),
    enabled: Boolean(month),
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmLock, setConfirmLock] = useState(false);
  const run = (p: Promise<unknown>) =>
    p
      .then(() => {
        setError(null);
        setConfirmLock(false);
        void qc.invalidateQueries({ queryKey: ["pay-periods"] });
        void qc.invalidateQueries({ queryKey: ["pay-preview"] });
      })
      .catch((e) => setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error")));

  const qty = (l: Line) =>
    l.unit === "amount"
      ? fmtKr(l.amount, locale, 2)
      : `${fmtHours(l.quantity, locale)} ${t(`pay.unit.${l.unit}` as MessageKey)}${l.unit === "km" && l.amount !== null ? ` · ${fmtKr(l.amount, locale, 2)}` : ""}`;
  const p = preview.data;
  const missing = p?.rows.filter((r) => !r.payrollNumber && r.lines.length).length ?? 0;
  const unapproved = p?.rows.reduce((a, r) => a + r.unapproved, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t("pay.months")} className="flex flex-wrap gap-2">
        {(periods.data ?? []).map((x) => (
          <button
            key={x.month}
            type="button"
            onClick={() => setChosen(x.month)}
            aria-current={x.month === month ? "true" : undefined}
            className={`flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm ${x.month === month ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-surface text-ink-900 hover:bg-surface-alt"}`}
          >
            <span className="first-letter:uppercase">
              {fmtDay(x.month, locale, { month: "short", year: "numeric" })}
            </span>
            <span className="text-xs opacity-75">{t(`pay.status.${x.status}` as MessageKey)}</span>
          </button>
        ))}
      </nav>

      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}

      {p && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium first-letter:uppercase">
                {fmtDay(p.period.month, locale, { month: "long", year: "numeric" })}{" "}
                <Badge tone={p.period.status === "locked" ? "brand" : "neutral"}>
                  {t(`pay.status.${p.period.status}` as MessageKey)}
                </Badge>
              </h2>
              {p.run && (
                <p className="text-xs text-ink-500">{t("pay.lastRun", { lines: p.run.lineCount })}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {p.run && (
                <a
                  className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-900 hover:bg-surface-alt"
                  href={`${API_URL}/api/v1/payroll/periods/${p.period.month}/file.csv`}
                >
                  ↓ {t("pay.download")}
                </a>
              )}
              {p.period.status !== "locked" && (
                <Button
                  variant={p.run ? "secondary" : "primary"}
                  onClick={() =>
                    void run(api(`/payroll/periods/${p.period.month}/export`, { method: "POST" }))
                  }
                >
                  {t(p.run ? "pay.regenerate" : "pay.generate")}
                </Button>
              )}
              {p.period.status === "exported" && !confirmLock && (
                <Button onClick={() => setConfirmLock(true)}>{t("pay.lock")}</Button>
              )}
              {confirmLock && (
                <span className="flex items-center gap-2 text-sm">
                  {t("pay.lockConfirm")}
                  <Button
                    onClick={() =>
                      void run(api(`/payroll/periods/${p.period.month}/lock`, { method: "POST" }))
                    }
                  >
                    {t("pay.lockYes")}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmLock(false)}>
                    {t("common.cancel")}
                  </Button>
                </span>
              )}
            </div>
          </div>

          {(missing > 0 || unapproved > 0) && (
            <ul className="mt-4 flex flex-col gap-1 text-sm text-warning">
              {missing > 0 && <li>⚠ {t("pay.warnMissing", { count: missing })}</li>}
              {unapproved > 0 && <li>⚠ {t("pay.warnUnapproved", { count: unapproved })}</li>}
            </ul>
          )}

          {p.rows.length === 0 ? (
            <p className="mt-4 text-sm text-ink-500">{t("pay.empty")}</p>
          ) : (
            <div className="-mx-5 mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th scope="col" className="px-5 py-2 text-left font-semibold">
                      {t("pay.employee")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      {t("pay.number")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      {t("pay.lines")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr
                      key={r.userId}
                      className={`border-b border-line align-top last:border-0 ${r.payrollNumber ? "" : "bg-surface-alt text-ink-500"}`}
                    >
                      <td className="px-5 py-2.5 font-semibold">
                        {r.fullName}
                        {r.unapproved > 0 && (
                          <p className="text-xs font-normal text-warning">
                            ⚠ {t("pay.rowUnapproved", { count: r.unapproved })}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {r.payrollNumber ?? <span className="text-warning">⚠ {t("pay.noNumber")}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <ul className="flex flex-col gap-0.5">
                          {r.lines.map((l) => (
                            <li key={`${l.code}-${l.originalPeriod ?? ""}`} className="tabular-nums">
                              <span className="font-semibold">{l.code}</span> {qty(l)}
                              {l.originalPeriod && (
                                <span className="text-xs text-ink-500">
                                  {" "}
                                  · {t("pay.late", { period: l.originalPeriod })}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Salary codes: provider code and include-in-export; mapping from absence codes. */
function SalaryCodes() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ["salary-codes"], queryFn: () => api<Setup>("/payroll/salary-codes") });
  const [error, setError] = useState<string | null>(null);
  const save = (p: Promise<unknown>) =>
    p
      .then(() => {
        setError(null);
        return qc.invalidateQueries({ queryKey: ["salary-codes"] });
      })
      .catch((e) => setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error")));
  const d = setup.data;
  if (!d) return <p className="text-ink-500">{t("common.loading")}</p>;
  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      <Card title={t("pay.codes")}>
        <p className="mb-4 text-sm text-ink-700">{t("pay.codesIntro")}</p>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-5 py-2 text-left font-semibold">
                  {t("pay.code")}
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  {t("pay.codeName")}
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  {t("pay.unit")}
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  {t("pay.providerCode")}
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  {t("pay.include")}
                </th>
              </tr>
            </thead>
            <tbody>
              {d.codes.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-2 font-semibold">{c.code}</td>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 text-ink-700">{t(`pay.unit.${c.unit}` as MessageKey)}</td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`${t("pay.providerCode")} ${c.code}`}
                      defaultValue={c.providerCode ?? ""}
                      className={`${field} w-24`}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== c.providerCode)
                          void save(
                            api(`/payroll/salary-codes/${c.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ providerCode: v }),
                            }),
                          );
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${t("pay.include")} ${c.code}`}
                      checked={c.includeInExport}
                      onChange={(e) =>
                        void save(
                          api(`/payroll/salary-codes/${c.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ includeInExport: e.target.checked }),
                          }),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={t("pay.mapping")}>
        <p className="mb-4 text-sm text-ink-700">{t("pay.mappingIntro")}</p>
        <ul className="flex flex-col gap-2">
          {d.absenceCodes.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
              <label htmlFor={`map-${a.id}`} className="w-56 text-ink-900">
                {locale === "da" ? a.nameDa : a.nameEn}
              </label>
              <select
                id={`map-${a.id}`}
                className={field}
                value={a.salaryCodeId ?? ""}
                onChange={(e) =>
                  void save(
                    api("/payroll/absence-mapping", {
                      method: "PUT",
                      body: JSON.stringify({ absenceCodeId: a.id, salaryCodeId: e.target.value || null }),
                    }),
                  )
                }
              >
                <option value="">{t("pay.notExported")}</option>
                {d.codes
                  .filter((c) => c.kind === "absence")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} – {c.name}
                    </option>
                  ))}
              </select>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
