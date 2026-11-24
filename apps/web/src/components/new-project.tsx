"use client";

/**
 * "Nyt projekt" form on the projects page (docs/spec/projects.md). Creates a project with one contract via
 * POST /api/v1/projects and opens the new project page; tasks, budget and payment plan are added there.
 */

import { todayCopenhagen } from "@arc-tid/domain";
import { Button, Card } from "@arc-tid/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api, type Person } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useMe } from "./session";

const field = "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm";
/**
 * The fee forms Finance uses (2026-11-17): Medgået tid, Medgået tid med loft (hours invoiced up to a cap, the rest is
 * free) and Fastpris. "capped" is time_material with maxHours. Existing Rammeaftale cases still work.
 */
type ContractType = "time_material" | "capped" | "fixed_price";

/** Short form: the essentials only. Tasks, budget and payment plan are added on the project page afterwards. */
export function NewProject({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const me = useMe();
  const router = useRouter();
  const [type, setType] = useState<ContractType>("time_material");
  const [customerId, setCustomerId] = useState("");
  /** "Viderefaktureres til kunden" must be chosen actively; an internal case (no customer) is always "Nej" */
  const [billable, setBillable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => api<{ id: string; name: string }[]>("/customers"),
  });
  const people = useQuery({ queryKey: ["users"], queryFn: () => api<Person[]>("/users") });
  const managers = (people.data ?? []).filter((p) => p.roles.includes("project_manager"));
  const num = (v: FormDataEntryValue | null) =>
    v ? Number(String(v).replace(/\./g, "").replace(",", ".")) : undefined;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (customerId && billable === null) {
      setError(t("np.billableRequired"));
      return;
    }
    try {
      const p = await api<{ id: string }>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          customerId: customerId || null,
          managerId: f.get("managerId"),
          contractType: type === "capped" ? "time_material" : type,
          maxHours: type === "capped" ? num(f.get("maxHours")) : undefined,
          price: type === "fixed_price" ? num(f.get("price")) : undefined,
          hourlyRate: num(f.get("hourlyRate")),
          startDate: f.get("startDate") || undefined,
          billable: Boolean(customerId) && billable === true,
        }),
      });
      router.push(`/projects/${p.id}`);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Card title={t("np.new")}>
      <form onSubmit={submit} className="grid gap-4 text-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-semibold text-ink-900">{t("np.name")}</span>
          {/* biome-ignore lint/a11y/noAutofocus: the form opens because the user clicked "Nyt projekt" */}
          <input name="name" required autoFocus className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("np.customer")}</span>
          <select
            name="customerId"
            className={field}
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              if (!e.target.value) setBillable(null);
            }}
          >
            <option value="">{t("np.internal")}</option>
            {(customers.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("np.manager")}</span>
          <select
            name="managerId"
            className={field}
            defaultValue={managers.some((m) => m.id === me.id) ? me.id : managers[0]?.id}
            required
          >
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1 sm:col-span-2">
          <legend className="mb-1 font-semibold text-ink-900">{t("np.contract")}</legend>
          <div className="flex flex-wrap gap-2">
            {(["time_material", "capped", "fixed_price"] as ContractType[]).map((c) => (
              <label
                key={c}
                className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 ${type === c ? "border-brand-600 bg-brand-50 text-ink-900" : "border-line"}`}
              >
                <input
                  type="radio"
                  name="contractType"
                  value={c}
                  checked={type === c}
                  onChange={() => setType(c)}
                  className="sr-only"
                />
                {c === "capped" ? t("np.capped") : t(`pr.type.${c}` as MessageKey)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1 sm:col-span-2">
          <legend className="mb-1 font-semibold text-ink-900">{t("np.billable")}</legend>
          {customerId ? (
            <div className="flex flex-wrap gap-2">
              {([true, false] as const).map((v) => (
                <label
                  key={String(v)}
                  className={`flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 ${billable === v ? "border-brand-600 bg-brand-50 text-ink-900" : "border-line"}`}
                >
                  <input
                    type="radio"
                    name="billable"
                    value={String(v)}
                    checked={billable === v}
                    onChange={() => setBillable(v)}
                    className="sr-only"
                  />
                  {t(v ? "np.billableYes" : "np.billableNo")}
                </label>
              ))}
            </div>
          ) : (
            <span className="text-ink-500">{t("np.billableInternal")}</span>
          )}
          <span className="text-xs text-ink-500">{t("np.billableHint")}</span>
        </fieldset>
        {type === "capped" && (
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("np.maxHours")}</span>
            <input name="maxHours" required inputMode="decimal" className={field} />
            <span className="text-xs text-ink-500">{t("np.cappedHint")}</span>
          </label>
        )}
        {type === "fixed_price" && (
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("np.price")}</span>
            <input name="price" required inputMode="decimal" className={field} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("np.rate")}</span>
          <input name="hourlyRate" inputMode="decimal" className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink-900">{t("np.start")}</span>
          <input name="startDate" type="date" defaultValue={todayCopenhagen()} className={field} />
        </label>
        <p className="text-xs text-ink-500 sm:col-span-2">{t("np.hint")}</p>
        {error && (
          <p role="alert" className="text-danger sm:col-span-2">
            ⚠ {error}
          </p>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit">{t("np.create")}</Button>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
