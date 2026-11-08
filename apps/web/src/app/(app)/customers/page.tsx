"use client";

import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";

interface Customer {
  id: string;
  number: string;
  name: string;
  cvr: string | null;
  ean: string | null;
  city: string | null;
  paymentTermsDays: number;
  projectCount: number;
}

export default function CustomersPage() {
  const { t } = useI18n();
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<Customer[]>("/customers") });
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-3xl font-normal">{t("cu.title")}</h1>
      {customers.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {customers.data && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("cu.number")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("cu.name")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("cu.cvr")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("cu.ean")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("cu.city")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("cu.terms")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  {t("cu.projects")}
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.data.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-alt">
                  <td className="px-4 py-3 tabular-nums">{c.number}</td>
                  <td className="px-4 py-3 font-semibold text-ink-900">{c.name}</td>
                  <td className="px-4 py-3 tabular-nums">{c.cvr}</td>
                  <td className="px-4 py-3 tabular-nums">{c.ean ?? "–"}</td>
                  <td className="px-4 py-3">{c.city}</td>
                  <td className="px-4 py-3">{t("cu.termsDays", { days: c.paymentTermsDays })}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.projectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
