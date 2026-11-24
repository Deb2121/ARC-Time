"use client";

/**
 * Employees ("Medarbejdere"): a searchable list and a profile panel per person. The panel answers the questions
 * people actually ask — what can this person do (roles and rights), who approves their timesheets (line manager),
 * what do they cost and earn (rates) — and lets Admin change it. Finance may edit rates and payroll numbers only.
 * Data: GET /users, GET/PATCH /admin/employees/:id, PUT /users/:id/roles.
 */
import { type Role, todayCopenhagen } from "@arc-tid/domain";
import { Badge, Button } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { GdprSection } from "@/components/gdpr-section";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { api, can, type Person } from "@/lib/api";
import { errorText } from "@/lib/errors";
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
  active: boolean;
  canCreateProjects: boolean;
  norms: { id: string; validFrom: string; patternId: string; patternName: string }[];
}
interface SettingsLite {
  normPatterns: { id: string; name: string }[];
  priceGroups: { id: string; name: string }[];
}

/** Roles an Admin can hand out; "employee" is implied for everyone. */
const ASSIGNABLE: Role[] = ["project_manager", "line_manager", "finance", "management", "admin"];

const field =
  "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";

/** Round initials badge; the selected person gets the brand colour. */
function Avatar({
  initials,
  size = "md",
  active = true,
}: {
  initials: string;
  size?: "md" | "lg";
  active?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${
        size === "lg" ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs"
      } ${active ? "bg-brand-50 text-brand-800" : "bg-surface-alt text-ink-500"}`}
    >
      {initials.slice(0, 3)}
    </span>
  );
}

export default function PeoplePage() {
  const { t } = useI18n();
  const me = useMe();
  const canEdit = can(me, "settings.read");
  const people = useQuery({ queryKey: ["users"], queryFn: () => api<Person[]>("/users") });
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const all = people.data ?? [];
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (p) =>
      !q ||
      p.fullName.toLowerCase().includes(q) ||
      p.initials.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q),
  );
  const person = selected ? byId.get(selected) : undefined;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-normal">{t("people.title")}</h1>
          <p className="mt-1 text-ink-700">{t("people.intro")}</p>
        </div>
        <label className="w-full sm:w-72">
          <span className="sr-only">{t("people.search")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("people.search")}
            className={field}
          />
        </label>
      </header>
      {people.isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {people.isError && (
        <p role="alert" className="text-danger">
          {errorText(people.error, t)}
        </p>
      )}
      <div className={`grid items-start gap-5 ${person ? "lg:grid-cols-[minmax(0,1fr)_440px]" : ""}`}>
        {people.data && (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line bg-surface-alt px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
              <span>{t("people.count", { count: shown.length })}</span>
              {canEdit && (
                <span className="hidden normal-case tracking-normal sm:inline">{t("people.clickHint")}</span>
              )}
            </div>
            {shown.length === 0 && <p className="px-4 py-6 text-sm text-ink-500">{t("people.noMatch")}</p>}
            <ul aria-label={t("people.title")}>
              {shown.map((p) => {
                const isSel = selected === p.id;
                const manager = p.managerId ? byId.get(p.managerId) : undefined;
                const row = (
                  <>
                    <Avatar initials={p.initials} active={p.active} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold text-ink-900">{p.fullName}</span>
                        {!p.active && <Badge>{t("people.inactive")}</Badge>}
                      </span>
                      <span className="block truncate text-xs text-ink-500">{p.email}</span>
                    </span>
                    <span
                      className={`hidden min-w-0 flex-[1.2] flex-wrap gap-1.5 md:flex ${person ? "lg:hidden xl:flex" : ""}`}
                    >
                      {p.roles
                        .filter((r) => r !== "employee")
                        .map((r) => (
                          <Badge key={r} tone="brand">
                            {t(`role.${r}` as MessageKey)}
                          </Badge>
                        ))}
                      {p.roles.every((r) => r === "employee") && <Badge>{t("role.employee")}</Badge>}
                    </span>
                    <span
                      className={`hidden w-40 shrink-0 text-xs text-ink-700 sm:block ${person ? "lg:hidden 2xl:block" : ""}`}
                    >
                      <span className="block text-ink-500">{t("people.approvedBy")}</span>
                      {manager?.fullName ?? t("people.byFinance")}
                    </span>
                  </>
                );
                return (
                  <li key={p.id} className="border-b border-line last:border-0">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setSelected(isSel ? null : p.id)}
                        aria-pressed={isSel}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                          isSel
                            ? "bg-brand-50/70 shadow-[inset_3px_0_0_var(--color-brand-600)]"
                            : "hover:bg-surface-alt"
                        }`}
                      >
                        {row}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-3 text-sm">{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {person && (
          <EmployeePanel
            key={person.id}
            person={person}
            people={all}
            isAdmin={can(me, "settings.manage")}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

/** One titled block in the profile panel. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the input/select is passed in as children
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold text-ink-900">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

/** Small fact tile in the panel header (who approves, how many they lead, employed since). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className="truncate text-sm font-semibold text-ink-900" title={value}>
        {value}
      </p>
    </div>
  );
}

function EmployeePanel({
  person,
  people,
  isAdmin,
  onClose,
}: {
  person: Person;
  people: Person[];
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const emp = useQuery({
    queryKey: ["employee", person.id],
    queryFn: () => api<EmployeeDetail>(`/admin/employees/${person.id}`),
  });
  const settings = useQuery({
    queryKey: ["settings-lite"],
    queryFn: () => api<SettingsLite>("/admin/settings"),
  });
  const [roles, setRoles] = useState<Role[]>(person.roles.filter((r) => r !== "employee"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const e = emp.data;

  const manager = people.find((p) => p.id === person.managerId);
  const reports = people.filter((p) => p.managerId === person.id && p.active);
  const managerOptions = people.filter((p) => p.id !== person.id && p.active);

  const day = (d: string) => fmtDay(d, locale, { day: "numeric", month: "short", year: "numeric" });
  const num = (v: FormDataEntryValue | null) =>
    Number(
      String(v ?? "0")
        .replace(/\./g, "")
        .replace(",", "."),
    );

  async function save(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!e) return;
    const f = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = {
      salesRate: num(f.get("salesRate")),
      costRate: num(f.get("costRate")),
      payrollNumber: String(f.get("payrollNumber") ?? "").trim(),
    };
    if (isAdmin) {
      Object.assign(body, {
        priceGroupId: f.get("priceGroupId") || null,
        managerId: f.get("managerId") || null,
        flexOpening: num(f.get("flexOpening")),
        vacationOpening: num(f.get("vacationOpening")),
        employmentEnd: f.get("employmentEnd") || null,
        active: f.get("active") === "on",
      });
    }
    setBusy(true);
    setMsg(null);
    try {
      const before = person.roles
        .filter((r) => r !== "employee")
        .sort()
        .join();
      if (isAdmin && [...roles].sort().join() !== before) {
        await api(`/users/${person.id}/roles`, { method: "PUT", body: JSON.stringify({ roles }) });
      }
      await api(`/admin/employees/${person.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg({ ok: true, text: t("emp.saved") });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["employee", person.id] }),
        qc.invalidateQueries({ queryKey: ["users"] }),
      ]);
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function changeNorm(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    try {
      await api(`/admin/employees/${person.id}/norms`, {
        method: "POST",
        body: JSON.stringify({ normPatternId: f.get("normPatternId"), validFrom: f.get("validFrom") }),
      });
      await qc.invalidateQueries({ queryKey: ["employee", person.id] });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    }
  }

  return (
    <aside
      aria-label={person.fullName}
      className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
    >
      {/* Profile header */}
      <div className="bg-gradient-to-br from-brand-50 via-surface-alt to-surface px-5 pb-4 pt-5">
        <div className="flex items-start gap-4">
          <Avatar initials={person.initials} size="lg" active={person.active} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-medium text-ink-900">{person.fullName}</h2>
            <p className="truncate text-sm text-ink-700">{person.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {person.roles
                .filter((r) => r !== "employee")
                .map((r) => (
                  <Badge key={r} tone="brand">
                    {t(`role.${r}` as MessageKey)}
                  </Badge>
                ))}
              {person.roles.every((r) => r === "employee") && <Badge>{t("role.employee")}</Badge>}
              {!person.active && <Badge>{t("people.inactive")}</Badge>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1.5 text-ink-500 hover:bg-surface hover:text-ink-900"
          >
            ✕
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Fact label={t("people.approvedBy")} value={manager?.fullName ?? t("people.byFinance")} />
          <Fact label={t("emp.leads")} value={t("emp.leadsCount", { count: reports.length })} />
          <Fact label={t("emp.since")} value={e ? day(e.employmentStart) : "…"} />
        </div>
      </div>

      {!e || !settings.data ? (
        <p className="border-t border-line px-5 py-4 text-sm text-ink-500">{t("common.loading")}</p>
      ) : (
        <>
          <form onSubmit={save}>
            {isAdmin && (
              <Section title={t("emp.access")} hint={t("emp.accessHint")}>
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-ink-900">{t("people.roles")}</legend>
                  <div className="grid gap-2">
                    {ASSIGNABLE.map((r) => {
                      const on = roles.includes(r);
                      return (
                        <label
                          key={r}
                          className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                            on ? "border-brand-600 bg-brand-50/60" : "border-line hover:bg-surface-alt"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setRoles(on ? roles.filter((x) => x !== r) : [...roles, r])}
                            className="mt-0.5 accent-[var(--color-brand-600)]"
                          />
                          <span>
                            <span className="font-semibold text-ink-900">{t(`role.${r}` as MessageKey)}</span>
                            <span className="block text-xs text-ink-500">
                              {t(`role.desc.${r}` as MessageKey)}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <Field
                  label={t("emp.manager")}
                  hint={t("emp.managerHint", { name: person.fullName.split(" ")[0] ?? "" })}
                >
                  <select name="managerId" defaultValue={person.managerId ?? ""} className={field}>
                    <option value="">{t("emp.noManager")}</option>
                    {managerOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName}
                        {p.roles.includes("line_manager") ? "" : ` (${t("emp.notLineManager")})`}
                      </option>
                    ))}
                  </select>
                </Field>
                {reports.length > 0 && (
                  <p className="text-xs text-ink-700">
                    {t("emp.approvesFor")} {reports.map((r) => r.fullName).join(", ")}
                  </p>
                )}
              </Section>
            )}

            <Section title={t("emp.prices")} hint={t("emp.pricesHint")}>
              {isAdmin && (
                <Field label={t("emp.priceGroup")}>
                  <select name="priceGroupId" defaultValue={e.priceGroupId ?? ""} className={field}>
                    <option value="">{t("emp.none")}</option>
                    {settings.data.priceGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("emp.salesRate")}>
                  <input
                    name="salesRate"
                    inputMode="decimal"
                    defaultValue={String(e.salesRate / 100).replace(".", ",")}
                    className={field}
                  />
                </Field>
                <Field label={t("emp.costRate")}>
                  <input
                    name="costRate"
                    inputMode="decimal"
                    defaultValue={String(e.costRate / 100).replace(".", ",")}
                    className={field}
                  />
                </Field>
              </div>
              <Field label={t("emp.payrollNumber")} hint={t("emp.payrollNumberHint")}>
                <input name="payrollNumber" defaultValue={e.payrollNumber ?? ""} className={field} />
              </Field>
            </Section>

            {isAdmin && (
              <Section title={t("emp.employment")} hint={t("emp.employmentHint")}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("emp.flexOpening")}>
                    <input
                      name="flexOpening"
                      inputMode="decimal"
                      defaultValue={String(e.flexOpening).replace(".", ",")}
                      className={field}
                    />
                  </Field>
                  <Field label={t("emp.vacationOpening")}>
                    <input
                      name="vacationOpening"
                      inputMode="decimal"
                      defaultValue={String(e.vacationOpening).replace(".", ",")}
                      className={field}
                    />
                  </Field>
                </div>
                <Field label={t("emp.employmentEnd")}>
                  <input
                    name="employmentEnd"
                    type="date"
                    defaultValue={e.employmentEnd ?? ""}
                    className={field}
                  />
                </Field>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={e.active}
                    className="mt-0.5 accent-[var(--color-brand-600)]"
                  />
                  <span>
                    <span className="font-semibold text-ink-900">{t("emp.active")}</span>
                    <span className="block text-xs text-ink-500">{t("emp.activeHint")}</span>
                  </span>
                </label>
              </Section>
            )}

            <div className="sticky bottom-0 flex items-center gap-3 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
              <Button type="submit" disabled={busy}>
                {busy ? t("common.loading") : t("emp.saveChanges")}
              </Button>
              {msg && (
                <p role="status" className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>
                  {msg.ok ? "✓ " : ""}
                  {msg.text}
                </p>
              )}
            </div>
          </form>

          <Section title={t("emp.normHistory")} hint={t("emp.normHint")}>
            <ol className="flex flex-col gap-1.5 text-sm">
              {e.norms.map((n, i) => (
                <li key={n.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-ink-700">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${i === 0 ? "bg-brand-600" : "bg-line"}`}
                    />
                    {day(n.validFrom)}
                  </span>
                  <span className={i === 0 ? "font-semibold text-ink-900" : "text-ink-700"}>
                    {n.patternName}
                  </span>
                </li>
              ))}
            </ol>
            {isAdmin && (
              <form
                onSubmit={changeNorm}
                className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-md bg-surface-alt p-3"
              >
                <select name="normPatternId" className={`${field} col-span-2`} aria-label={t("emp.norm")}>
                  {settings.data.normPatterns.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Field label={t("emp.validFrom")}>
                  <input
                    name="validFrom"
                    type="date"
                    required
                    defaultValue={todayCopenhagen()}
                    className={field}
                  />
                </Field>
                <Button type="submit" variant="secondary">
                  {t("emp.changeNorm")}
                </Button>
              </form>
            )}
          </Section>

          {isAdmin && (
            <div className="border-t border-line px-5 py-4">
              <GdprSection userId={person.id} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}
