"use client";

import { Badge } from "@arc-tid/ui";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { api, type Person } from "@/lib/api";

export default function PeoplePage() {
  const { t } = useI18n();
  const people = useQuery({ queryKey: ["users"], queryFn: () => api<Person[]>("/users") });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex items-end justify-between">
        <h1 className="text-3xl font-normal">{t("people.title")}</h1>
        {people.data && (
          <p className="text-sm text-ink-500">{t("people.count", { count: people.data.length })}</p>
        )}
      </header>

      {people.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {people.isError && (
        <p role="alert" className="text-danger">
          {t("common.error")}
        </p>
      )}

      {people.data && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("people.initials")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("people.name")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("people.email")}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t("people.roles")}
                </th>
              </tr>
            </thead>
            <tbody>
              {people.data.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-alt">
                  <td className="px-4 py-3 font-semibold text-ink-900">{p.initials}</td>
                  <td className="px-4 py-3 text-ink-900">{p.fullName}</td>
                  <td className="px-4 py-3">{p.email}</td>
                  <td className="px-4 py-3">
                    <ul className="flex flex-wrap gap-1.5">
                      {p.roles
                        .filter((r) => r !== "employee")
                        .map((r) => (
                          <li key={r}>
                            <Badge tone="brand">{t(`role.${r}`)}</Badge>
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
    </div>
  );
}
