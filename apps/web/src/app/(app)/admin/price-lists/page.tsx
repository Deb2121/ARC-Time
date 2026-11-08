"use client";

import { todayCopenhagen } from "@arc-tid/domain";
import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { fmtDay, fmtKr } from "@/lib/format";

interface Rate {
  id: string;
  priceGroupId: string | null;
  taskTypeId: string | null;
  rate: number;
  validFrom: string;
}
interface Data {
  lists: { id: string; name: string; isStandard: boolean; customerName: string | null; rates: Rate[] }[];
  groups: { id: string; name: string }[];
  taskTypes: { id: string; name: string }[];
  canEdit: boolean;
}

const field = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";

export default function PriceListsPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["price-lists"], queryFn: () => api<Data>("/price-lists") });
  const [adding, setAdding] = useState<string | null>(null);
  const d = data.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["price-lists"] });

  async function add(e: FormEvent<HTMLFormElement>, listId: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api(`/price-lists/${listId}/rates`, {
      method: "POST",
      body: JSON.stringify({
        priceGroupId: f.get("group") || null,
        taskTypeId: f.get("type") || null,
        rate: Number(String(f.get("rate")).replace(/\./g, "").replace(",", ".")),
        validFrom: f.get("validFrom"),
      }),
    });
    setAdding(null);
    await refresh();
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-normal">{t("pl.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-700">{t("pl.intro")}</p>
      </header>
      {data.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {d?.lists.map((l) => (
        <Card key={l.id}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-medium">
              {l.name} {l.isStandard && <Badge tone="brand">{t("pl.standard")}</Badge>}
              {l.customerName && (
                <span className="ml-2 text-sm font-normal text-ink-500">{l.customerName}</span>
              )}
            </h2>
            {d.canEdit && adding !== l.id && (
              <Button variant="ghost" onClick={() => setAdding(l.id)}>
                + {t("pl.addRate")}
              </Button>
            )}
          </div>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-semibold">
                    {t("pl.group")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("pl.taskType")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("pl.rate")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("pl.validFrom")}
                  </th>
                  {d.canEdit && (
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">{t("pl.delete")}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {l.rates.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-2 text-ink-900">
                      {d.groups.find((g) => g.id === r.priceGroupId)?.name ?? (
                        <span className="text-ink-500">{t("pl.any")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.taskTypes.find((x) => x.id === r.taskTypeId)?.name ?? (
                        <span className="text-ink-500">{t("pl.any")}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-ink-900">
                      {fmtKr(r.rate, locale, 2)}
                    </td>
                    <td className="px-3 py-2">
                      {fmtDay(r.validFrom, locale, { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    {d.canEdit && (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-xs font-semibold text-ink-500 hover:text-danger"
                          onClick={() => api(`/price-list-rates/${r.id}`, { method: "DELETE" }).then(refresh)}
                        >
                          {t("pl.delete")}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {adding === l.id && (
            <form
              onSubmit={(e) => add(e, l.id)}
              className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-surface-alt p-4 text-sm"
            >
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("pl.group")}</span>
                <select name="group" className={field}>
                  <option value="">{t("pl.any")}</option>
                  {d.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("pl.taskType")}</span>
                <select name="type" className={field}>
                  <option value="">{t("pl.any")}</option>
                  {d.taskTypes.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-32 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("pl.rate")}</span>
                <input name="rate" required inputMode="decimal" className={field} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("pl.validFrom")}</span>
                <input
                  name="validFrom"
                  type="date"
                  required
                  defaultValue={todayCopenhagen()}
                  className={field}
                />
              </label>
              <Button type="submit">{t("common.save")}</Button>
              <Button variant="ghost" onClick={() => setAdding(null)}>
                {t("common.cancel")}
              </Button>
            </form>
          )}
        </Card>
      ))}
    </div>
  );
}
