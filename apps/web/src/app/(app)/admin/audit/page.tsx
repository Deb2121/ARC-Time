"use client";

/**
 * Audit log ("Revisionsspor", docs/spec/administration.md R1–R2, D-025): who changed what, when, from what to what,
 * and why. Finance sees financial entries; Management and Admin see everything. Read-only — the log cannot be
 * edited by anyone. Data: GET /audit (apps/api/src/services/audit-log.ts).
 */
import { Button, Card } from "@arc-tid/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useI18n } from "@/i18n";
import { da, type MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";
import { fmtDay, fmtHours, fmtKr, fmtPct } from "@/lib/format";

interface AuditRow {
  id: string;
  at: string;
  entity: string;
  entityId: string;
  action: string;
  actor: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
}

const field = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";

type Translate = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Internal bookkeeping fields that mean nothing to a user; ids are shown as names elsewhere. */
const HIDDEN = new Set(["id", "tenantId", "createdAt", "updatedAt", "sort"]);
const MONEY = new Set([
  "amount",
  "costAmount",
  "grossAmount",
  "netAmount",
  "vatAmount",
  "originalAmount",
  "unitPrice",
  "budgetAmount",
  "hourlyRate",
]);
const HOURS = new Set(["hours", "budgetHours"]);
/** Fields whose values already have texts elsewhere in the app. */
const VALUE_PREFIX: Record<string, string> = {
  roles: "role",
  mode: "adm.approvalMode",
  grouping: "inv.group",
};

const isKey = (k: string): k is MessageKey => k in da;
const isHidden = (key: string, v: unknown) =>
  HIDDEN.has(key) ||
  (typeof v === "string" && UUID.test(v)) ||
  (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && UUID.test(x)));

/** Field name for people: a translation, or "budgetHours" → "Budget hours" as a last resort. */
function fieldLabel(key: string, t: Translate) {
  const k = `audit.field.${key}`;
  if (isKey(k)) return t(k);
  const words = key
    .replace(/Bp$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One value in plain language: no JSON, codes, ids or raw timestamps. */
function showValue(key: string, v: unknown, t: Translate, locale: Locale): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return t(v ? "audit.yes" : "audit.no");
  if (key === "warnings" && Array.isArray(v)) {
    if (v.length === 0) return t("audit.none");
    return v
      .map((w: { code?: string; count?: number }) => {
        const k = `per.warn.${w.code}`;
        return isKey(k) ? t(k, { count: w.count ?? 0 }) : t("audit.items", { count: w.count ?? 0 });
      })
      .join(" · ");
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return t("audit.none");
    if (v.every((x) => typeof x === "string")) return v.map((x) => showValue(key, x, t, locale)).join(", ");
    return t("audit.items", { count: v.length });
  }
  if (typeof v === "object") return t("audit.items", { count: Object.keys(v).length });
  if (key.endsWith("Bp") && !Number.isNaN(Number(v))) return fmtPct(Number(v), locale);
  if (MONEY.has(key) && !Number.isNaN(Number(v))) return fmtKr(Number(v), locale, 2);
  if (HOURS.has(key) && !Number.isNaN(Number(v))) return fmtHours(Number(v), locale);
  if (typeof v === "number") return new Intl.NumberFormat(locale === "da" ? "da-DK" : "en-GB").format(v);
  const str = String(v);
  if (/^d{4}-d{2}-d{2}$/.test(str))
    return key === "month"
      ? fmtDay(str, locale, { month: "long", year: "numeric" })
      : fmtDay(str, locale, { day: "numeric", month: "short", year: "numeric" });
  if (/^d{4}-d{2}-d{2}T/.test(str))
    return new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Copenhagen",
    }).format(new Date(str));
  const own = VALUE_PREFIX[key] && `${VALUE_PREFIX[key]}.${str}`;
  if (own && isKey(own)) return t(own);
  const general = `audit.value.${str}`;
  if (/^[a-z_]+$/.test(str) && isKey(general)) return t(general);
  return str;
}

/** "før → efter" per changed field (or the snapshot when only one side exists), in plain language. */
function changes(before: AuditRow["before"], after: AuditRow["after"], t: Translate, locale: Locale) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .filter((k) => !isHidden(k, before?.[k] ?? after?.[k]))
    .filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .map((k) => ({
      key: k,
      label: fieldLabel(k, t),
      before: showValue(k, before?.[k], t, locale),
      after: showValue(k, after?.[k], t, locale),
    }));
}

/** System-written reasons are stored in English; people's own reasons are shown as written. */
function reasonText(reason: string | null, t: Translate) {
  if (!reason) return "";
  const k = `audit.reason.${reason}`;
  return isKey(k) ? t(k) : reason;
}

export default function AuditPage() {
  const { t, locale } = useI18n();
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const entities = useQuery({
    queryKey: ["audit-entities"],
    queryFn: () => api<string[]>("/audit/entities"),
  });
  const params = new URLSearchParams({
    limit: "50",
    ...(entity && { entity }),
    ...(from && { from }),
    ...(to && { to }),
  });
  const log = useInfiniteQuery({
    queryKey: ["audit", entity, from, to],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{ rows: AuditRow[]; next: string | null }>(
        `/audit?${params}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.rows) ?? [];
  const label = (k: string, prefix: string) => {
    const key = `${prefix}.${k}` as MessageKey;
    const s = t(key);
    return s === key ? k : s;
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Copenhagen",
    }).format(new Date(iso));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("audit.title")}</h1>
        <p className="mt-1 text-ink-700">{t("audit.intro")}</p>
      </header>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("audit.what")}</span>
          <select className={field} value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">{t("audit.all")}</option>
            {(entities.data ?? []).map((x) => (
              <option key={x} value={x}>
                {label(x, "audit.entity")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("rp.from")}</span>
          <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("rp.to")}</span>
          <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <Card>
        {log.isLoading ? (
          <p className="text-ink-500">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-ink-500">{t("audit.empty")}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("audit.when")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("audit.who")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("audit.what")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("audit.action")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("audit.reason")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-line">
                      <td className="whitespace-nowrap px-5 py-2 tabular-nums text-ink-700">{when(r.at)}</td>
                      <td className="px-3 py-2">{r.actor ?? t("audit.system")}</td>
                      <td className="px-3 py-2">{label(r.entity, "audit.entity")}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="font-semibold text-brand-700 hover:underline"
                          aria-expanded={open === r.id}
                          onClick={() => setOpen(open === r.id ? null : r.id)}
                        >
                          {label(r.action, "audit.action")}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-ink-700">{reasonText(r.reason, t)}</td>
                    </tr>
                    {open === r.id && (
                      <tr className="border-b border-line bg-surface-alt">
                        <td colSpan={5} className="px-5 py-3">
                          {(() => {
                            const list = changes(r.before, r.after, t, locale);
                            if (list.length === 0)
                              return <p className="text-xs text-ink-500">{t("audit.noDetails")}</p>;
                            return (
                              <table className="text-xs">
                                <tbody>
                                  {list.map((c) => (
                                    <tr key={c.key}>
                                      <td className="py-0.5 pr-4 font-semibold text-ink-900">{c.label}</td>
                                      {c.before !== "–" && (
                                        <td className="pr-2 text-ink-500 line-through">{c.before}</td>
                                      )}
                                      <td className="text-ink-900" colSpan={c.before === "–" ? 2 : 1}>
                                        {c.before !== "–" && "→ "}
                                        {c.after}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.hasNextPage && (
          <div className="mt-4">
            <Button
              variant="secondary"
              onClick={() => void log.fetchNextPage()}
              disabled={log.isFetchingNextPage}
            >
              {t("audit.more")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
