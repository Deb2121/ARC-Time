"use client";

import { hasRole } from "@arc-tid/domain";
import { Badge, Button } from "@arc-tid/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { NewProject } from "@/components/new-project";
import { HealthDot, Progress } from "@/components/progress";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api } from "@/lib/api";
import { fmtHours, fmtKr, fmtPct } from "@/lib/format";

export interface ProjectSummary {
  id: string;
  number: string;
  name: string;
  status: string;
  customerName: string | null;
  managerName: string | null;
  managerInitials: string | null;
  contractTypes: string[];
  budgetHours: number;
  usedHours: number;
  budgetAmount: number;
  usedValue: number;
  usedCost: number;
  remainingHours: number;
  hoursConsumptionBp: number | null;
  contributionMargin: number;
  marginBp: number | null;
  health: string;
}

export default function ProjectsPage() {
  const { t, locale } = useI18n();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<ProjectSummary[]>("/projects") });
  const me = useMe();
  const canCreate = hasRole(me.roles, "admin", "finance", "project_manager");
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-3xl font-normal">{t("pr.title")}</h1>
        {canCreate && !creating && <Button onClick={() => setCreating(true)}>+ {t("np.new")}</Button>}
      </header>
      {creating && <NewProject onCancel={() => setCreating(false)} />}
      {projects.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {projects.data?.length === 0 && <p className="text-ink-500">{t("pr.empty")}</p>}
      {projects.data && projects.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("pr.number")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("pr.name")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("pr.contract")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("pr.manager")}
                </th>
                <th scope="col" className="w-48 px-4 py-3 font-semibold">
                  {t("pr.used")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("pr.value")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("pr.marginPct")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("pr.health")}
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.data.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-alt">
                  <td className="px-4 py-3 font-semibold tabular-nums text-ink-900">{p.number}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-semibold text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="block text-xs text-ink-500">{p.customerName ?? t("pr.internal")}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {p.contractTypes.map((c) => (
                        <Badge key={c}>{t(`pr.type.${c}` as MessageKey)}</Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3" title={p.managerName ?? ""}>
                    {p.managerInitials}
                  </td>
                  <td className="px-4 py-3">
                    <span className="mb-1 flex justify-between text-xs tabular-nums">
                      <span>
                        {fmtHours(p.usedHours / 100, locale)} / {fmtHours(p.budgetHours / 100, locale)} t
                      </span>
                      <span>{fmtPct(p.hoursConsumptionBp, locale)}</span>
                    </span>
                    <Progress
                      bp={p.hoursConsumptionBp}
                      label={`${p.name}: ${fmtPct(p.hoursConsumptionBp, locale)}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtKr(p.usedValue, locale)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtPct(p.marginBp, locale)}</td>
                  <td className="px-4 py-3">
                    <HealthDot health={p.health} label={t(`pr.health.${p.health}` as MessageKey)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
