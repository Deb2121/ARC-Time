"use client";

import { addDays, startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import { Badge, Button } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";
import { fmtFlex, fmtHours, fmtPct, weekLabel } from "@/lib/format";

interface Item {
  periodId: string | null;
  user: { id: string; fullName: string; initials: string };
  status: string;
  norm: number;
  work: number;
  absence: number;
  billable: number;
  billableBp: number | null;
  flex: number;
  anomalies: { date: string; kind: "over" | "under" }[];
  projects: { number: string; name: string; hours: number }[];
}

export default function ApprovalPage() {
  return (
    <Suspense>
      <Approval />
    </Suspense>
  );
}

function Approval() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  // Default to last week: that is the week people normally approve.
  const weekStart = startOfIsoWeek(params.get("week") ?? addDays(todayCopenhagen(), -7));
  const inbox = useQuery({
    queryKey: ["approvals", weekStart],
    queryFn: () => api<{ items: Item[] }>(`/approvals?weekStart=${weekStart}`),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<{ id: string; comment: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const done = () => {
    setSelected(new Set());
    setRejecting(null);
    void qc.invalidateQueries({ queryKey: ["approvals"] });
  };
  const approve = useMutation({
    mutationFn: (id: string) => api(`/approvals/${id}/approve`, { method: "POST" }),
    onSuccess: done,
  });
  const bulk = useMutation({
    mutationFn: (ids: string[]) =>
      api("/approvals/bulk-approve", { method: "POST", body: JSON.stringify({ periodIds: ids }) }),
    onSuccess: done,
  });
  const reject = useMutation({
    mutationFn: (r: { id: string; comment: string }) =>
      api(`/approvals/${r.id}/reject`, { method: "POST", body: JSON.stringify({ comment: r.comment }) }),
    onSuccess: done,
  });

  const items = inbox.data?.items ?? [];
  const submittable = items.filter((i) => i.status === "submitted" && i.periodId);
  const go = (w: string) => router.push(`/approval?week=${w}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-500">{weekLabel(weekStart, locale)}</p>
          <h1 className="mt-1 text-3xl font-normal">{t("ap.title")}</h1>
          <p className="mt-1 text-ink-700">{t("ap.intro")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => go(addDays(weekStart, -7))} aria-label={t("ts.prev")}>
            ←
          </Button>
          <Button variant="secondary" onClick={() => go(addDays(weekStart, 7))} aria-label={t("ts.next")}>
            →
          </Button>
        </div>
      </header>

      {submittable.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.size === submittable.length}
              onChange={(e) =>
                setSelected(new Set(e.target.checked ? submittable.map((i) => i.periodId as string) : []))
              }
            />
            {t("ap.selectAll")}
          </label>
          <Button disabled={selected.size === 0 || bulk.isPending} onClick={() => bulk.mutate([...selected])}>
            {t("ap.approveSelected", { count: selected.size })}
          </Button>
        </div>
      )}

      {inbox.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {!inbox.isLoading && items.length === 0 && <p className="text-ink-500">{t("ap.empty")}</p>}

      <ul className="flex flex-col gap-3">
        {items.map((i) => {
          const over = i.anomalies.filter((a) => a.kind === "over").length;
          const under = i.anomalies.filter((a) => a.kind === "under").length;
          const canDecide = i.status === "submitted" && i.periodId;
          return (
            <li key={i.user.id} className="rounded-lg border border-line bg-surface">
              <div className="flex flex-wrap items-center gap-4 p-4">
                {canDecide ? (
                  <input
                    type="checkbox"
                    aria-label={i.user.fullName}
                    checked={selected.has(i.periodId as string)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(i.periodId as string);
                      else next.delete(i.periodId as string);
                      setSelected(next);
                    }}
                  />
                ) : (
                  <span className="w-[13px]" />
                )}
                <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                  {i.user.initials}
                </span>
                <div className="min-w-40 flex-1">
                  <p className="font-semibold text-ink-900">{i.user.fullName}</p>
                  <Badge tone={i.status === "approved" ? "brand" : "neutral"}>
                    {t(`ts.status.${i.status}` as MessageKey)}
                  </Badge>
                </div>
                <dl className="grid grid-cols-4 gap-x-6 text-sm tabular-nums">
                  <Fig label={t("ts.norm")} value={fmtHours(i.norm, locale)} />
                  <Fig label={t("ts.registered")} value={fmtHours(i.work + i.absence, locale)} />
                  <Fig label={t("ts.billablePct")} value={fmtPct(i.billableBp, locale)} />
                  <Fig
                    label={t("ts.flexWeek")}
                    value={fmtFlex(i.flex, locale)}
                    tone={i.flex < 0 ? "warning" : undefined}
                  />
                </dl>
                <div className="min-w-36 text-xs text-warning">
                  {over > 0 && <p>⚠ {t("ap.anomalyOver", { count: over })}</p>}
                  {under > 0 && i.status !== "not_submitted" && (
                    <p>⚠ {t("ap.anomalyUnder", { count: under })}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setExpanded(expanded === i.user.id ? null : i.user.id)}
                    aria-expanded={expanded === i.user.id}
                  >
                    {t("ap.projects")}
                  </Button>
                  <Link
                    href={`/timesheet?week=${weekStart}&user=${i.user.id}`}
                    className="inline-flex h-10 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink-700 hover:bg-surface-alt"
                  >
                    {t("ap.open")}
                  </Link>
                  {canDecide && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setRejecting({ id: i.periodId as string, comment: "" })}
                      >
                        {t("ap.reject")}
                      </Button>
                      <Button
                        onClick={() => approve.mutate(i.periodId as string)}
                        disabled={approve.isPending}
                      >
                        {t("ap.approve")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {expanded === i.user.id && (
                <table className="w-full border-t border-line text-sm">
                  <tbody>
                    {i.projects.map((p) => (
                      <tr key={p.number} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 pl-16 text-ink-900">
                          {p.number} {p.name}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtHours(p.hours, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {rejecting?.id === i.periodId && (
                <form
                  className="flex flex-wrap items-end gap-3 border-t border-line bg-surface-alt p-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (rejecting.comment.trim()) reject.mutate(rejecting);
                  }}
                >
                  <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm">
                    <span className="font-semibold text-ink-900">{t("ap.rejectReason")}</span>
                    <input
                      // biome-ignore lint/a11y/noAutofocus: opened by the user's reject action
                      autoFocus
                      required
                      value={rejecting.comment}
                      onChange={(e) => setRejecting({ ...rejecting, comment: e.target.value })}
                      className="h-10 rounded-[var(--radius-control)] border border-line bg-surface px-3"
                    />
                  </label>
                  <Button type="submit" disabled={!rejecting.comment.trim() || reject.isPending}>
                    {t("ap.reject")}
                  </Button>
                  <Button variant="ghost" onClick={() => setRejecting(null)}>
                    {t("common.cancel")}
                  </Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Fig({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={`font-semibold ${tone === "warning" ? "text-warning" : "text-ink-900"}`}>{value}</dd>
    </div>
  );
}
