"use client";

/**
 * "Ferie og fridage" (D-037): the employee's leave accounts (løntidskonti) for ferie and feriefridage, laid out like
 * the account in TimeLog: date, text, days, factor, positive, negative and a running balance. Monthly accrual is
 * posted automatically at each month's end; approved leave from Min uge is drawn. Finance/Admin can pick any
 * employee, add a manual posting (correction, carry-over, payout, lapse) and set the feriefridage rate.
 * Data: /leave/* (apps/api/src/routes/leave.ts).
 */
import { Button, Card } from "@arc-tid/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";
import { api, type Person } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtDay } from "@/lib/format";

type AccountKind = "ferie" | "feriefridag";
interface Line {
  date: string;
  kind: "accrual" | "taken" | "adjustment";
  text: string;
  days: number;
  balance: number;
}
interface Account {
  account: AccountKind;
  perMonth: number;
  openingDate: string;
  opening: number;
  lines: Line[];
  earned: number;
  used: number;
  balance: number;
  pending: number;
  available: number;
}
interface Accounts {
  userId: string;
  fullName: string;
  today: string;
  canManage: boolean;
  accounts: Account[];
}

const field = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
const num = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));

export default function LeavePage() {
  return (
    <Suspense>
      <Leave />
    </Suspense>
  );
}

function Leave() {
  const { t } = useI18n();
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const userId = params.get("user") ?? me.id;
  const q = useQuery({
    queryKey: ["leave", userId],
    queryFn: () => api<Accounts>(`/leave/accounts${userId === me.id ? "" : `?userId=${userId}`}`),
  });
  const people = useQuery({ queryKey: ["users"], queryFn: () => api<Person[]>("/users") });
  const others = (people.data ?? []).filter((p) => p.active);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-normal">{t("lv.title")}</h1>
          <p className="mt-1 max-w-3xl text-ink-700">{t("lv.intro")}</p>
        </div>
        {others.length > 1 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink-900">{t("lv.employee")}</span>
            <select
              className={`${field} h-10 min-w-56`}
              value={userId}
              onChange={(e) =>
                router.replace(e.target.value === me.id ? "/leave" : `/leave?user=${e.target.value}`)
              }
            >
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {q.isError && <p className="text-sm text-danger">⚠ {errorText(q.error, t)}</p>}
      {q.data?.accounts.map((a) => (
        <AccountCard key={a.account} account={a} userId={q.data.userId} canManage={q.data.canManage} />
      ))}
    </div>
  );
}

/** One account: key figures, the postings with running balance and (Finance/Admin) a manual posting. */
function AccountCard({
  account: a,
  userId,
  canManage,
}: {
  account: Account;
  userId: string;
  canManage: boolean;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [rate, setRate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = (centi: number) =>
    new Intl.NumberFormat(locale === "da" ? "da-DK" : "en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(centi / 100);
  const date = (s: string) => fmtDay(s, locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["leave", userId] });
    void qc.invalidateQueries({ queryKey: ["balances"] });
  };
  const fri = a.account === "feriefridag";

  async function post(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/leave/adjustments", {
        method: "POST",
        body: JSON.stringify({
          userId,
          account: a.account,
          date: f.get("date"),
          days: num(String(f.get("days"))),
          text: f.get("text"),
        }),
      });
      setAdding(false);
      setError(null);
      refresh();
    } catch (err) {
      setError(errorText(err, t));
    }
  }
  async function saveRate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api(`/leave/employees/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          perMonth: num(String(f.get("perMonth"))),
          opening: num(String(f.get("opening"))),
        }),
      });
      setRate(false);
      setError(null);
      refresh();
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  if (fri && a.perMonth === 0 && a.lines.length === 0 && a.opening === 0 && !canManage) return null;

  return (
    <Card title={t(fri ? "lv.feriefridag" : "lv.ferie")}>
      <div className="-mt-1 mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Figure label={t("lv.balance")} value={d(a.balance)} strong />
        <Figure label={t("lv.earned")} value={d(a.earned)} />
        <Figure label={t("lv.used")} value={d(a.used)} />
        <Figure label={t("lv.pending")} value={d(a.pending)} hint={t("lv.pendingHint")} />
        <Figure
          label={t("lv.rate")}
          value={a.perMonth ? `${d(a.perMonth)} ${t("lv.perMonth")}` : t("lv.none")}
          hint={fri ? t("lv.rateHintFri") : t("lv.rateHintFerie")}
        />
      </div>

      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th scope="col" className="px-5 py-2 text-left font-semibold">
                {t("lv.date")}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {t("lv.text")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("lv.days")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("lv.factor")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("lv.positive")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("lv.negative")}
              </th>
              <th scope="col" className="px-5 py-2 text-right font-semibold">
                {t("lv.running")}
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <tr className="border-b border-line bg-surface-alt/50">
              <td className="px-5 py-2 font-semibold text-ink-900" colSpan={6}>
                {t("lv.openingRow", { date: date(a.openingDate) })}
              </td>
              <td className="px-5 py-2 text-right font-semibold text-ink-900">{d(a.opening)}</td>
            </tr>
            {a.lines.map((l) => (
              <tr key={`${l.date}-${l.kind}-${l.text}-${l.balance}`} className="border-b border-line">
                <td className="px-5 py-1.5 text-ink-700">{date(l.date)}</td>
                <td className="px-3 py-1.5 text-ink-900">
                  {l.kind === "accrual" ? t("lv.accrualText") : l.text}
                  {l.kind === "adjustment" && (
                    <span className="ml-2 text-xs text-ink-500">({t("lv.manual")})</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">{d(Math.abs(l.days))}</td>
                <td className="px-3 py-1.5 text-right text-ink-500">{l.days < 0 ? "-1,00" : "1,00"}</td>
                <td className="px-3 py-1.5 text-right text-success">{l.days > 0 ? d(l.days) : ""}</td>
                <td className="px-3 py-1.5 text-right text-danger">{l.days < 0 ? d(l.days) : ""}</td>
                <td className="px-5 py-1.5 text-right text-ink-900">{d(l.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-900/10">
              <td className="px-5 py-2 font-semibold text-ink-900" colSpan={6}>
                {t("lv.closingRow", { date: date(a.lines.at(-1)?.date ?? a.openingDate) })}
              </td>
              <td className="px-5 py-2 text-right font-semibold text-ink-900">{d(a.balance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {a.pending > 0 && (
        <p className="mt-3 text-xs text-ink-500">{t("lv.pendingNote", { days: d(a.pending) })}</p>
      )}
      {a.available < 0 && (
        <p role="alert" className="mt-2 text-sm text-warning">
          ⚠ {t("lv.negativeWarn", { days: d(a.available) })}
        </p>
      )}

      {canManage && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {!adding && (
              <Button variant="ghost" onClick={() => setAdding(true)}>
                + {t("lv.addPosting")}
              </Button>
            )}
            {fri && !rate && (
              <Button variant="ghost" onClick={() => setRate(true)}>
                {t("lv.setRate")}
              </Button>
            )}
          </div>
          {adding && (
            <form
              onSubmit={post}
              className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-alt p-4 text-sm"
            >
              <label className="flex flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("lv.date")}</span>
                <input name="date" type="date" required className={field} />
              </label>
              <label className="flex w-28 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("lv.days")}</span>
                <input name="days" required inputMode="decimal" placeholder="-2,5" className={field} />
              </label>
              <label className="flex min-w-60 flex-1 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("lv.text")}</span>
                <input
                  name="text"
                  required
                  maxLength={200}
                  placeholder={t("lv.textPlaceholder")}
                  className={field}
                />
              </label>
              <Button type="submit">{t("common.save")}</Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </Button>
              <p className="w-full text-xs text-ink-500">{t("lv.postingHint")}</p>
            </form>
          )}
          {rate && (
            <form
              onSubmit={saveRate}
              className="flex flex-wrap items-end gap-3 rounded-lg bg-surface-alt p-4 text-sm"
            >
              <label className="flex w-40 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("lv.ratePerMonth")}</span>
                <input
                  name="perMonth"
                  required
                  inputMode="decimal"
                  defaultValue={d(a.perMonth)}
                  className={field}
                />
              </label>
              <label className="flex w-40 flex-col gap-1">
                <span className="font-semibold text-ink-900">{t("lv.openingBalance")}</span>
                <input
                  name="opening"
                  required
                  inputMode="decimal"
                  defaultValue={d(a.opening)}
                  className={field}
                />
              </label>
              <Button type="submit">{t("common.save")}</Button>
              <Button variant="ghost" onClick={() => setRate(false)}>
                {t("common.cancel")}
              </Button>
              <p className="w-full text-xs text-ink-500">{t("lv.rateFormHint")}</p>
            </form>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line p-3" title={hint}>
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`tabular-nums text-ink-900 ${strong ? "text-2xl font-semibold" : "text-lg"}`}>{value}</p>
    </div>
  );
}
