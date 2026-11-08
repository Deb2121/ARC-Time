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
import { ApiError, api, type Person } from "@/lib/api";
import { useMe } from "./session";

const field = "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm";
type ContractType = "time_material" | "fixed_price" | "retainer";

/** Short form: the essentials only. Tasks, budget and payment plan are added on the project page afterwards. */
export function NewProject({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const me = useMe();
  const router = useRouter();
  const [type, setType] = useState<ContractType>("time_material");
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
    const customerId = (f.get("customerId") as string) || null;
    try {
      const p = await api<{ id: string }>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name: f.get("name"),
          customerId,
          managerId: f.get("managerId"),
          contractType: type,
          price: type !== "time_material" ? num(f.get("price")) : undefined,
          hourlyRate: num(f.get("hourlyRate")),
          startDate: f.get("startDate") || undefined,
          billable: customerId !== null,
          commentRequired: f.get("commentRequired") === "on",
        }),
      });
      router.push(`/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? t(`err.${err.code}` as MessageKey) : t("common.error"));
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
          <select name="customerId" className={field} defaultValue="">
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
            {(["time_material", "fixed_price", "retainer"] as ContractType[]).map((c) => (
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
                {t(`pr.type.${c}` as MessageKey)}
              </label>
            ))}
          </div>
        </fieldset>
        {type !== "time_material" && (
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">
              {t(type === "fixed_price" ? "np.price" : "np.fee")}
            </span>
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
        <label className="flex items-center gap-2 self-end pb-2">
          <input type="checkbox" name="commentRequired" />
          {t("np.commentRequired")}
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
