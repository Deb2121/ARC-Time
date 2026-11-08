"use client";

import { Badge, Button, Card } from "@arc-tid/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";
import { API_URL, ApiError, api } from "@/lib/api";
import { fmtDay, fmtHours, fmtKr } from "@/lib/format";

interface Line {
  id: string;
  kind: "time" | "milestone" | "product" | "text" | "heading" | "subtotal";
  description: string;
  quantity: number;
  unitPrice: number;
  discountBp: number;
  amount: number;
  originalAmount: number | null;
  writeReason: string | null;
  vatBp: number;
  sourceCount: number;
}
interface Invoice {
  id: string;
  number: number | null;
  type: "invoice" | "credit";
  status: "draft" | "ready" | "booked";
  invoiceDate: string;
  dueDate: string;
  heading: string | null;
  ourReference: string | null;
  theirReference: string | null;
  attachSpecification: boolean;
  currency: string;
  externalId: string | null;
  creditOfId: string | null;
  customer: {
    name: string;
    number: string;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    ean: string | null;
  } | null;
  lines: Line[];
  totals: {
    subtotal: number;
    vat: number;
    total: number;
    vatByRate: { vatBp: number; base: number; vat: number }[];
  };
  credits: { id: string; number: number | null; status: string; total: number }[];
  canBook: boolean;
}

const field =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm text-ink-900";
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const inv = useQuery({ queryKey: ["invoice", id], queryFn: () => api<Invoice>(`/invoices/${id}`) });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    writeReason: string;
  } | null>(null);
  const [newLine, setNewLine] = useState<{
    kind: "product" | "text" | "heading" | "subtotal";
    description: string;
    quantity: string;
    unitPrice: string;
  } | null>(null);
  const [confirmBook, setConfirmBook] = useState(false);
  const [crediting, setCrediting] = useState<{ reopen: boolean } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["invoice", id] });
  const run = (fn: () => Promise<unknown>) =>
    fn()
      .then(() => {
        setError(null);
        return refresh();
      })
      .catch((e) => setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error")));

  const book = useMutation({
    mutationFn: () => api<{ number: number }>(`/invoices/${id}/book`, { method: "POST" }),
    onSuccess: () => {
      setConfirmBook(false);
      void refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? t(`err.${e.code}` as MessageKey) : t("common.error")),
  });

  if (inv.isLoading || !inv.data) return <p className="text-ink-500">{t("common.loading")}</p>;
  const d = inv.data;
  const editable = d.status !== "booked";
  const title = d.type === "credit" ? t("inv.credit") : t("inv.invoice");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={`/invoicing?tab=${editable ? "drafts" : "booked"}`}
            className="text-sm text-ink-500 hover:text-ink-900"
          >
            ← {t("inv.back")}
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-normal">
            {title} {d.number ?? ""}
            <Badge tone={d.status === "booked" ? "brand" : "neutral"}>
              {t(`inv.status.${d.status}` as MessageKey)}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-ink-700">
            {d.customer?.name} · {t("cu.number")} {d.customer?.number}
            {d.customer?.ean ? ` · EAN ${d.customer.ean}` : ""}
            {d.externalId ? ` · e-conomic ${d.externalId}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-900 hover:bg-surface-alt"
            href={`${API_URL}/api/v1/invoices/${id}/html`}
            target="_blank"
            rel="noreferrer"
          >
            {t("inv.preview")}
          </a>
          <a
            className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-ink-900 hover:bg-surface-alt"
            href={`${API_URL}/api/v1/invoices/${id}/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            ↓ {t("inv.pdf")}
          </a>
          {d.status === "draft" && (
            <Button
              variant="secondary"
              onClick={() => run(() => api(`/invoices/${id}/ready`, { method: "POST" }))}
            >
              {t("inv.markReady")}
            </Button>
          )}
          {editable && d.canBook && <Button onClick={() => setConfirmBook(true)}>{t("inv.book")}</Button>}
          {d.status === "booked" && d.type === "invoice" && (
            <Button variant="secondary" onClick={() => setCrediting({ reopen: true })}>
              {t("inv.makeCredit")}
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          ⚠ {error}
        </p>
      )}
      {confirmBook && (
        <div
          role="alertdialog"
          aria-label={t("inv.book")}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm"
        >
          <span className="text-ink-900">{t("inv.bookConfirm")}</span>
          <span className="flex gap-2">
            <Button onClick={() => book.mutate()} disabled={book.isPending}>
              {t("inv.book")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmBook(false)}>
              {t("common.cancel")}
            </Button>
          </span>
        </div>
      )}
      {crediting && (
        <div
          role="alertdialog"
          aria-label={t("inv.makeCredit")}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 text-sm"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={crediting.reopen}
              onChange={(e) => setCrediting({ reopen: e.target.checked })}
            />
            {t("inv.reopenSources")}
          </label>
          <span className="flex gap-2">
            <Button
              onClick={() =>
                api<{ id: string }>(`/invoices/${id}/credit`, {
                  method: "POST",
                  body: JSON.stringify({ reopenSources: crediting.reopen }),
                }).then((r) => router.push(`/invoicing/${r.id}`))
              }
            >
              {t("inv.makeCredit")}
            </Button>
            <Button variant="ghost" onClick={() => setCrediting(null)}>
              {t("common.cancel")}
            </Button>
          </span>
        </div>
      )}

      <Card>
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="font-semibold text-ink-900">{t("inv.heading")}</span>
            <input
              className={field}
              defaultValue={d.heading ?? ""}
              disabled={!editable}
              onBlur={(e) =>
                e.target.value !== (d.heading ?? "") &&
                run(() =>
                  api(`/invoices/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ heading: e.target.value }),
                  }),
                )
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("inv.invoiceDate")}</span>
            <input
              type="date"
              className={field}
              defaultValue={d.invoiceDate}
              disabled={!editable}
              onBlur={(e) =>
                e.target.value !== d.invoiceDate &&
                run(() =>
                  api(`/invoices/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ invoiceDate: e.target.value }),
                  }),
                )
              }
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("inv.due")}</span>
            <span className="flex h-9 items-center">
              {fmtDay(d.dueDate, locale, { day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("inv.ourRef")}</span>
            <input
              className={field}
              defaultValue={d.ourReference ?? ""}
              disabled={!editable}
              onBlur={(e) =>
                run(() =>
                  api(`/invoices/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ ourReference: e.target.value }),
                  }),
                )
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">{t("inv.theirRef")}</span>
            <input
              className={field}
              defaultValue={d.theirReference ?? ""}
              disabled={!editable}
              onBlur={(e) =>
                run(() =>
                  api(`/invoices/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ theirReference: e.target.value }),
                  }),
                )
              }
            />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              defaultChecked={d.attachSpecification}
              disabled={!editable}
              onChange={(e) =>
                run(() =>
                  api(`/invoices/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ attachSpecification: e.target.checked }),
                  }),
                )
              }
            />
            {t("inv.spec")}
          </label>
        </div>
      </Card>

      <Card title={t("inv.lines")}>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm tabular-nums">
            <thead className="border-y border-line bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" className="px-5 py-2 text-left font-semibold">
                  {t("inv.description")}
                </th>
                <th scope="col" className="w-24 px-3 py-2 text-right font-semibold">
                  {t("inv.quantity")}
                </th>
                <th scope="col" className="w-32 px-3 py-2 text-right font-semibold">
                  {t("inv.unitPrice")}
                </th>
                <th scope="col" className="w-36 px-3 py-2 text-right font-semibold">
                  {t("inv.amount")}
                </th>
                {editable && (
                  <th scope="col" className="w-28 px-3 py-2">
                    <span className="sr-only">{t("common.save")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) =>
                editing?.id === l.id ? (
                  <tr key={l.id} className="border-b border-line bg-surface-alt/60">
                    <td className="px-5 py-2" colSpan={1}>
                      <input
                        aria-label={t("inv.description")}
                        className={field}
                        value={editing.description}
                        onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                      />
                      {l.sourceCount > 0 && (
                        <input
                          aria-label={t("inv.writeReason")}
                          placeholder={t("inv.writeReason")}
                          className={`${field} mt-2`}
                          value={editing.writeReason}
                          onChange={(e) => setEditing({ ...editing, writeReason: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {["time", "milestone", "product"].includes(l.kind) && (
                        <input
                          aria-label={t("inv.quantity")}
                          inputMode="decimal"
                          className={`${field} text-right`}
                          value={editing.quantity}
                          disabled={l.sourceCount > 0}
                          onChange={(e) => setEditing({ ...editing, quantity: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {["time", "milestone", "product"].includes(l.kind) && (
                        <input
                          aria-label={t("inv.unitPrice")}
                          inputMode="decimal"
                          className={`${field} text-right`}
                          value={editing.unitPrice}
                          disabled={l.sourceCount > 0}
                          onChange={(e) => setEditing({ ...editing, unitPrice: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {["time", "milestone", "product"].includes(l.kind) && (
                        <input
                          aria-label={t("inv.amount")}
                          inputMode="decimal"
                          className={`${field} text-right`}
                          value={editing.amount}
                          onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="flex justify-end gap-1">
                        <Button
                          className="h-8 px-3"
                          onClick={() => {
                            const body: Record<string, unknown> = { description: editing.description };
                            const amountChanged = num(editing.amount) * 100 !== l.amount;
                            if (l.sourceCount > 0) {
                              if (amountChanged)
                                Object.assign(body, {
                                  amount: num(editing.amount),
                                  writeReason: editing.writeReason,
                                });
                            } else if (amountChanged) body.amount = num(editing.amount);
                            else
                              Object.assign(body, {
                                quantity: num(editing.quantity),
                                unitPrice: num(editing.unitPrice),
                              });
                            void run(() =>
                              api(`/invoice-lines/${l.id}`, { method: "PATCH", body: JSON.stringify(body) }),
                            ).then(() => setEditing(null));
                          }}
                        >
                          {t("common.save")}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 px-2"
                          onClick={() => setEditing(null)}
                          aria-label={t("common.cancel")}
                        >
                          ✕
                        </Button>
                      </span>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={l.id}
                    className={`border-b border-line ${l.kind === "heading" ? "font-semibold text-ink-900" : ""}`}
                  >
                    <td className="px-5 py-2.5">
                      <span className={l.kind === "text" ? "text-ink-500" : "text-ink-900"}>
                        {l.description}
                      </span>
                      {l.sourceCount > 0 && (
                        <span className="ml-2 text-xs text-ink-500">
                          ({t("inv.sources", { count: l.sourceCount })})
                        </span>
                      )}
                      {l.originalAmount !== null && l.originalAmount !== l.amount && (
                        <span className="block text-xs text-warning">
                          {t("inv.adjusted", { amount: fmtKr(l.originalAmount, locale, 2) })}
                          {l.writeReason ? ` · ${l.writeReason}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {["time", "milestone", "product"].includes(l.kind) ? fmtHours(l.quantity, locale) : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {["time", "milestone", "product"].includes(l.kind) ? fmtKr(l.unitPrice, locale, 2) : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-ink-900">
                      {["time", "milestone", "product"].includes(l.kind) ? fmtKr(l.amount, locale, 2) : ""}
                    </td>
                    {editable && (
                      <td className="px-3 py-2.5 text-right">
                        <span className="flex justify-end gap-2 text-xs font-semibold">
                          <button
                            type="button"
                            className="text-ink-500 hover:text-brand-700"
                            onClick={() =>
                              setEditing({
                                id: l.id,
                                description: l.description,
                                quantity: fmtHours(l.quantity, locale),
                                unitPrice: (l.unitPrice / 100).toFixed(2).replace(".", ","),
                                amount: (l.amount / 100).toFixed(2).replace(".", ","),
                                writeReason: l.writeReason ?? "",
                              })
                            }
                          >
                            ✎ <span className="sr-only">{l.description}</span>
                          </button>
                          <button
                            type="button"
                            className="text-ink-500 hover:text-danger"
                            aria-label={`${t("pl.delete")}: ${l.description}`}
                            onClick={() => run(() => api(`/invoice-lines/${l.id}`, { method: "DELETE" }))}
                          >
                            🗑
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        {editable && !newLine && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(["product", "text", "heading", "subtotal"] as const).map((k) => (
              <Button
                key={k}
                variant="ghost"
                onClick={() =>
                  setNewLine({
                    kind: k,
                    description: k === "subtotal" ? t("inv.subtotal") : "",
                    quantity: "1",
                    unitPrice: "",
                  })
                }
              >
                + {t(`inv.kind.${k}` as MessageKey)}
              </Button>
            ))}
          </div>
        )}
        {newLine && (
          <form
            className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-surface-alt p-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api(`/invoices/${id}/lines`, {
                  method: "POST",
                  body: JSON.stringify({
                    kind: newLine.kind,
                    description: newLine.description,
                    ...(newLine.kind === "product"
                      ? { quantity: num(newLine.quantity), unitPrice: num(newLine.unitPrice) }
                      : {}),
                  }),
                }),
              ).then(() => setNewLine(null));
            }}
          >
            <label className="flex min-w-72 flex-1 flex-col gap-1">
              <span className="font-semibold text-ink-900">
                {t(`inv.kind.${newLine.kind}` as MessageKey)}
              </span>
              <input
                // biome-ignore lint/a11y/noAutofocus: opened by the user's add action
                autoFocus
                required
                className={field}
                value={newLine.description}
                onChange={(e) => setNewLine({ ...newLine, description: e.target.value })}
              />
            </label>
            {newLine.kind === "product" && (
              <>
                <label className="flex w-24 flex-col gap-1">
                  <span className="font-semibold text-ink-900">{t("inv.quantity")}</span>
                  <input
                    inputMode="decimal"
                    className={field}
                    value={newLine.quantity}
                    onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1">
                  <span className="font-semibold text-ink-900">{t("inv.unitPrice")}</span>
                  <input
                    inputMode="decimal"
                    required
                    className={field}
                    value={newLine.unitPrice}
                    onChange={(e) => setNewLine({ ...newLine, unitPrice: e.target.value })}
                  />
                </label>
              </>
            )}
            <Button type="submit">{t("common.save")}</Button>
            <Button variant="ghost" onClick={() => setNewLine(null)}>
              {t("common.cancel")}
            </Button>
          </form>
        )}

        <dl className="ml-auto mt-6 grid w-full max-w-sm grid-cols-2 gap-y-1 text-sm tabular-nums">
          <dt className="text-ink-700">{t("inv.subtotal")}</dt>
          <dd className="text-right">{fmtKr(d.totals.subtotal, locale, 2)}</dd>
          {d.totals.vatByRate.map((v) => (
            <div key={v.vatBp} className="contents">
              <dt className="text-ink-700">
                {t("inv.vat")} {v.vatBp / 100} %
              </dt>
              <dd className="text-right">{fmtKr(v.vat, locale, 2)}</dd>
            </div>
          ))}
          <dt className="border-t-2 border-ink-900 pt-2 font-semibold text-ink-900">{t("inv.total")}</dt>
          <dd className="border-t-2 border-ink-900 pt-2 text-right font-[family-name:var(--font-display)] text-xl text-ink-900">
            {fmtKr(d.totals.total, locale, 2)}
          </dd>
        </dl>
      </Card>

      {editable && (
        <div>
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() =>
              run(() => api(`/invoices/${id}`, { method: "DELETE" })).then(() =>
                router.push("/invoicing?tab=drafts"),
              )
            }
          >
            {t("inv.delete")}
          </Button>
        </div>
      )}

      {d.credits.length > 0 && (
        <Card title={t("inv.credits")}>
          <ul className="text-sm">
            {d.credits.map((c) => (
              <li key={c.id}>
                <Link href={`/invoicing/${c.id}`} className="font-semibold text-brand-700 hover:underline">
                  {t("inv.credit")} {c.number ?? t("inv.status.draft")}
                </Link>{" "}
                · {fmtKr(c.total, locale, 2)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
