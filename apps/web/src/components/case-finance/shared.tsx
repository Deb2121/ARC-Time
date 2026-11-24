"use client";

/**
 * Shared pieces of the case finance screens (Sagsoversigt, case finance page, Debitorliste, D-029): the row
 * types returned by the API, status/fee badges, summary tiles and a sortable column header.
 * The calculations themselves live in @arc-tid/domain and on the server; these only display them.
 */
import type { CaseStatus, DebtStatus, FeeType } from "@arc-tid/domain";
import { type ReactNode, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";

export interface CaseRow {
  id: string;
  number: string;
  name: string;
  projectStatus: string;
  customerId: string;
  customerName: string;
  managerId: string | null;
  managerName: string | null;
  feeType: FeeType;
  hours: number;
  forbrugt: number;
  kostpris: number;
  /** of which sub-consultants' invoices (D-041), øre */
  underraadgivere: number;
  faktureret: number;
  ikkeFaktureret: number;
  fee: number | null;
  resthonorar: number | null;
  forbrugtPct: number | null;
  feeLevel: "ok" | "warning" | "alert" | null;
  feeWarning: string | null;
  nextInstalment: { date: string; amount: number; description: string; status: string } | null;
  readyInstalments: number;
  readyAmount: number;
  caseStatus: CaseStatus;
}

export interface Option {
  id: string;
  name: string;
}

export interface ReceivableRow {
  id: string;
  number: number;
  customerId: string;
  customerName: string;
  projectId: string | null;
  caseLabel: string | null;
  managerId: string | null;
  managerName: string | null;
  invoiceDate: string;
  dueDate: string;
  total: number;
  credited: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  status: DebtStatus;
  bucket: string | null;
  reminders: number[];
  lastReminder: string | null;
  synced: boolean;
}

const TONES = {
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/10 text-success",
  brand: "bg-brand-50 text-brand-800",
  neutral: "bg-surface-alt text-ink-700",
} as const;
type Tone = keyof typeof TONES;

/** A small coloured pill (status label). */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<CaseStatus, Tone> = {
  honorar_overskredet: "danger",
  overskridelsesrisiko: "warning",
  rate_klar: "brand",
  kan_faktureres: "success",
  ajour: "neutral",
};

/** Case status label (Kan faktureres, Rate klar, Overskridelsesrisiko, Honorar overskredet, Ajour). */
export function CaseStatusPill({ status }: { status: CaseStatus }) {
  const { t } = useI18n();
  return <Pill tone={STATUS_TONE[status]}>{t(`cf.status.${status}` as MessageKey)}</Pill>;
}

/** Fee type label shown wherever a case appears (medgået tid / fast honorar). */
export function FeeTypePill({ feeType }: { feeType: FeeType }) {
  const { t } = useI18n();
  return (
    <Pill tone={feeType === "fast_honorar" ? "brand" : "neutral"}>
      {t(`cf.fee.${feeType}` as MessageKey)}
    </Pill>
  );
}

const DEBT_TONE: Record<DebtStatus, Tone> = {
  aaben: "neutral",
  forfalden: "danger",
  delvist_betalt: "warning",
  betalt: "success",
  krediteret: "neutral",
};

/** Debtor status: Åben, Forfalden X dage, Delvist betalt, Betalt (or Krediteret). */
export function DebtStatusPill({ status, daysOverdue }: { status: DebtStatus; daysOverdue: number }) {
  const { t } = useI18n();
  const days = daysOverdue === 1 ? t("dl.day") : t("dl.days", { n: daysOverdue });
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Pill tone={DEBT_TONE[status]}>{t(`dl.status.${status}` as MessageKey, { days })}</Pill>
      {status === "delvist_betalt" && daysOverdue > 0 && (
        <span className="text-xs text-danger">{t("dl.overdueDays", { n: daysOverdue })}</span>
      )}
    </span>
  );
}

/** A summary card above a table; `compact` for rows of many cards (smaller figure that never wraps). */
export function Tile({
  label,
  value,
  sub,
  tone,
  compact,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone | undefined;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-ink-500">{label}</p>
      <p
        className={`mt-1 whitespace-nowrap font-[family-name:var(--font-display)] tabular-nums ${compact ? "text-lg" : "text-2xl"} ${tone === "danger" ? "text-danger" : "text-ink-900"}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

/** Sorting state for a table: click a header to sort by it, click again to reverse. */
export function useSort<T>(
  rows: T[],
  accessors: Record<string, (r: T) => string | number | null>,
  initial: string,
) {
  const [key, setKey] = useState(initial);
  const [dir, setDir] = useState<1 | -1>(1);
  const sorted = useMemo(() => {
    const get = accessors[key];
    if (!get) return rows;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const c =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "da", { numeric: true });
      return c * dir;
    });
  }, [rows, accessors, key, dir]);
  const toggle = (k: string) => {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setKey(k);
      setDir(1);
    }
  };
  return { sorted, key, dir, toggle };
}

type SortState = { key: string; dir: 1 | -1; toggle: (k: string) => void };

/** One sort button inside a header cell. */
function SortButton({
  id,
  label,
  sort,
  align = "left",
}: {
  id: string;
  label: string;
  sort: SortState;
  align?: "left" | "right";
}) {
  const { t } = useI18n();
  const active = sort.key === id;
  return (
    <button
      type="button"
      onClick={() => sort.toggle(id)}
      title={t("cf.sortBy", { col: label })}
      className={`inline-flex items-end gap-1 uppercase tracking-wide hover:text-ink-900 ${align === "right" ? "text-right" : "text-left"}`}
    >
      {label}
      <span aria-hidden="true" className={active ? "text-ink-900" : "text-ink-500 opacity-50"}>
        {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

/**
 * A table header cell that sorts its column and announces the sort order to screen readers. `second` adds a
 * second sort button for a cell that shows two values (e.g. "Sagsnr. / Sag").
 */
export function SortTh({
  id,
  label,
  sort,
  second,
  third,
  fourth,
  align = "left",
}: {
  id: string;
  label: string;
  sort: SortState;
  second?: { id: string; label: string };
  third?: { id: string; label: string };
  fourth?: { id: string; label: string };
  align?: "left" | "right";
}) {
  const extra = [second, third, fourth].filter((x): x is { id: string; label: string } => Boolean(x));
  const active = sort.key === id || extra.some((x) => x.id === sort.key);
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={`px-2 py-2 align-bottom font-semibold ${align === "right" ? "text-right" : "text-left"}`}
    >
      <SortButton id={id} label={label} sort={sort} align={align} />
      {extra.map((x) => (
        <span key={x.id} className="whitespace-nowrap">
          <span className="mx-1 text-ink-500" aria-hidden="true">
            /
          </span>
          <SortButton id={x.id} label={x.label} sort={sort} />
        </span>
      ))}
    </th>
  );
}

/** A labelled select used by the filter bars. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold text-ink-900">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-40 rounded-[var(--radius-control)] border border-line bg-surface px-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
