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
import type { MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";

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

/** "før → efter" per changed field (or the snapshot when only one side exists). */
function changes(before: AuditRow["before"], after: AuditRow["after"]) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const show = (v: unknown) =>
    v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return keys
    .filter((k) => show(before?.[k]) !== show(after?.[k]))
    .map((k) => ({ key: k, before: show(before?.[k]), after: show(after?.[k]) }));
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
                      <td className="px-3 py-2 text-ink-700">{r.reason ?? ""}</td>
                    </tr>
                    {open === r.id && (
                      <tr className="border-b border-line bg-surface-alt">
                        <td colSpan={5} className="px-5 py-3">
                          <table className="text-xs">
                            <tbody>
                              {changes(r.before, r.after).map((c) => (
                                <tr key={c.key}>
                                  <td className="pr-4 font-semibold text-ink-900">{c.key}</td>
                                  <td className="pr-2 text-ink-500 line-through">{c.before}</td>
                                  <td className="text-ink-900">→ {c.after}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-2 text-xs text-ink-500">
                            {t("audit.ref")}: {r.entityId}
                          </p>
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
