"use client";

import { hasRole, todayCopenhagen } from "@arc-tid/domain";
import { Badge, Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { ApiError, api, type Person } from "@/lib/api";
import { fmtDay } from "@/lib/format";

interface EmployeeDetail {
  id: string;
  fullName: string;
  employmentStart: string;
  employmentEnd: string | null;
  priceGroupId: string | null;
  salesRate: number;
  costRate: number;
  flexOpening: number;
  vacationOpening: number;
  payrollNumber: string | null;
  norms: { id: string; validFrom: string; patternId: string; patternName: string }[];
}
interface SettingsLite {
  normPatterns: { id: string; name: string }[];
  priceGroups: { id: string; name: string }[];
}

const field = "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";

export default function PeoplePage() {
  const { t } = useI18n();
  const me = useMe();
  const canEdit = hasRole(me.roles, "admin", "finance");
  const people = useQuery({ queryKey: ["users"], queryFn: () => api<Person[]>("/users") });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
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
      <div className={`grid gap-5 ${selected ? "lg:grid-cols-[1fr_360px]" : ""}`}>
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
                  <tr
                    key={p.id}
                    className={`border-b border-line last:border-0 ${selected === p.id ? "bg-brand-50" : "hover:bg-surface-alt"}`}
                  >
                    <td className="px-4 py-3 font-semibold text-ink-900">{p.initials}</td>
                    <td className="px-4 py-3 text-ink-900">
                      {canEdit ? (
                        <button
                          type="button"
                          className="font-semibold hover:text-brand-700 hover:underline"
                          onClick={() => setSelected(p.id)}
                        >
                          {p.fullName}
                        </button>
                      ) : (
                        p.fullName
                      )}
                    </td>
                    <td className="px-4 py-3">{p.email}</td>
                    <td className="px-4 py-3">
                      <ul className="flex flex-wrap gap-1.5">
                        {p.roles
                          .filter((r) => r !== "employee")
                          .map((r) => (
                            <li key={r}>
                              <Badge tone="brand">{t(`role.${r}` as MessageKey)}</Badge>
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
        {selected && (
          <EmployeePanel
            id={selected}
            isAdmin={hasRole(me.roles, "admin")}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

function EmployeePanel({ id, isAdmin, onClose }: { id: string; isAdmin: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const emp = useQuery({
    queryKey: ["employee", id],
    queryFn: () => api<EmployeeDetail>(`/admin/employees/${id}`),
  });
  const settings = useQuery({
    queryKey: ["settings-lite"],
    queryFn: () => api<SettingsLite>("/admin/settings"),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const e = emp.data;
  if (!e || !settings.data) return <Card>{t("common.loading")}</Card>;
  const num = (v: FormDataEntryValue | null) =>
    Number(
      String(v ?? "0")
        .replace(/\./g, "")
        .replace(",", "."),
    );

  async function save(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = {
      salesRate: num(f.get("salesRate")),
      costRate: num(f.get("costRate")),
    };
    // Only send the payroll number when the field is on the form (never clear it by accident).
    if (f.has("payrollNumber")) body.payrollNumber = String(f.get("payrollNumber")).trim();
    if (isAdmin) {
      Object.assign(body, {
        priceGroupId: f.get("priceGroupId") || null,
        flexOpening: num(f.get("flexOpening")),
        vacationOpening: num(f.get("vacationOpening")),
        employmentEnd: f.get("employmentEnd") || null,
      });
    }
    try {
      await api(`/admin/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg(t("emp.saved"));
      await qc.invalidateQueries({ queryKey: ["employee", id] });
    } catch (err) {
      setMsg(err instanceof ApiError ? t(`err.${err.code}` as MessageKey) : t("common.error"));
    }
  }
  async function changeNorm(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    await api(`/admin/employees/${id}/norms`, {
      method: "POST",
      body: JSON.stringify({ normPatternId: f.get("normPatternId"), validFrom: f.get("validFrom") }),
    });
    await qc.invalidateQueries({ queryKey: ["employee", id] });
  }

  return (
    <Card className="self-start">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-ink-500">{t("emp.edit")}</p>
          <h2 className="text-lg font-medium">{e.fullName}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="text-ink-500 hover:text-ink-900"
        >
          ✕
        </button>
      </div>

      <section className="mb-5 text-sm">
        <h3 className="mb-2 font-semibold text-ink-900">{t("emp.normHistory")}</h3>
        <ul className="mb-3 flex flex-col gap-1">
          {e.norms.map((n) => (
            <li key={n.id} className="flex justify-between">
              <span className="text-ink-700">
                {fmtDay(n.validFrom, locale, { day: "numeric", month: "short", year: "numeric" })}
              </span>
              <span className="font-semibold text-ink-900">{n.patternName}</span>
            </li>
          ))}
        </ul>
        {isAdmin && (
          <form onSubmit={changeNorm} className="flex flex-col gap-2 rounded-lg bg-surface-alt p-3">
            <span className="font-semibold text-ink-900">{t("emp.changeNorm")}</span>
            <select name="normPatternId" className={field} aria-label={t("emp.norm")}>
              {settings.data.normPatterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-500">{t("emp.validFrom")}</span>
              <input
                name="validFrom"
                type="date"
                required
                defaultValue={todayCopenhagen()}
                className={field}
              />
            </label>
            <Button type="submit" variant="secondary">
              {t("emp.changeNorm")}
            </Button>
          </form>
        )}
      </section>

      <form onSubmit={save} className="flex flex-col gap-3 text-sm">
        {isAdmin && (
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("emp.priceGroup")}</span>
            <select name="priceGroupId" defaultValue={e.priceGroupId ?? ""} className={field}>
              <option value="">{t("emp.none")}</option>
              {settings.data.priceGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("emp.salesRate")}</span>
            <input
              name="salesRate"
              inputMode="decimal"
              defaultValue={String(e.salesRate / 100).replace(".", ",")}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("emp.costRate")}</span>
            <input
              name="costRate"
              inputMode="decimal"
              defaultValue={String(e.costRate / 100).replace(".", ",")}
              className={field}
            />
          </label>
        </div>
        {isAdmin && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("emp.flexOpening")}</span>
                <input
                  name="flexOpening"
                  inputMode="decimal"
                  defaultValue={String(e.flexOpening).replace(".", ",")}
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("emp.vacationOpening")}</span>
                <input
                  name="vacationOpening"
                  inputMode="decimal"
                  defaultValue={String(e.vacationOpening).replace(".", ",")}
                  className={field}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("emp.payrollNumber")}</span>
              <input name="payrollNumber" defaultValue={e.payrollNumber ?? ""} className={field} />
              <span className="text-xs text-ink-500">{t("emp.payrollNumberHint")}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("emp.employmentEnd")}</span>
              <input
                name="employmentEnd"
                type="date"
                defaultValue={e.employmentEnd ?? ""}
                className={field}
              />
            </label>
          </>
        )}
        <Button type="submit">{t("common.save")}</Button>
        {msg && (
          <p role="status" className="text-ink-700">
            {msg}
          </p>
        )}
      </form>
    </Card>
  );
}
