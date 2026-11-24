"use client";

/**
 * A project member's own hourly price on a case (D-038): shown under the person in "Projektdeltagere" and changed
 * with a dropdown of the case's hourly rate, the customer's and the standard price list, or a price typed in by hand.
 * Only the project manager, Finance and Admin see it (the API leaves prices out for everyone else).
 */
import { Button } from "@arc-tid/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { fmtKr } from "@/lib/format";

/** A stored member price: øre per hour, and the price list line it came from (null = typed in by hand). */
export interface MemberPriceValue {
  rate: number;
  label: string | null;
}

/** The choices for the dropdown, from GET /projects/:id. */
export interface RateChoices {
  billable: boolean;
  caseRate: number | null;
  choices: { label: string; rate: number; list: string }[];
}

const field = "h-9 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";

/** One member's price line with a "Pris" button that opens the dropdown; saves via PUT …/members/:userId/rate. */
export function MemberPrice({
  projectId,
  userId,
  name,
  price,
  choices,
  onDone,
}: {
  projectId: string;
  userId: string;
  name: string;
  price: MemberPriceValue | null;
  choices: RateChoices;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("case");
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const kr = (ore: number) => `${fmtKr(ore, locale)}/t`;

  const save = useMutation({
    mutationFn: (body: { rate: number | null; label?: string | null }) =>
      api(`/projects/${projectId}/members/${userId}/rate`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      onDone();
    },
    onError: (e) => setError(errorText(e, t)),
  });

  function start() {
    const i = price?.label
      ? choices.choices.findIndex((c) => c.label === price.label && c.rate === price.rate)
      : -1;
    setPick(price === null ? "case" : i >= 0 ? `c${i}` : "manual");
    setManual(price && i < 0 ? String(price.rate / 100).replace(".", ",") : "");
    setError(null);
    setOpen(true);
  }

  function submit() {
    if (pick === "case") return save.mutate({ rate: null });
    if (pick === "manual") {
      const v = Number(manual.replace(/\./g, "").replace(",", "."));
      if (!manual.trim() || Number.isNaN(v) || v < 0) return setError(t("pr.price.manualRequired"));
      return save.mutate({ rate: v, label: null });
    }
    const c = choices.choices[Number(pick.slice(1))];
    if (c) save.mutate({ rate: c.rate / 100, label: c.label });
  }

  const caseText =
    choices.caseRate !== null
      ? t("pr.price.caseRate", { rate: kr(choices.caseRate) })
      : t("pr.price.caseRateNone");
  const lists = [...new Set(choices.choices.map((c) => c.list))];

  return (
    <div className="text-xs">
      {!open && (
        <p className="flex flex-wrap items-center gap-x-2 text-ink-500">
          <span>
            {price ? (
              <>
                <span className="font-semibold text-ink-900 tabular-nums">{kr(price.rate)}</span> ·{" "}
                {price.label ?? t("pr.price.manual")}
              </>
            ) : (
              caseText
            )}
          </span>
          <button
            type="button"
            onClick={start}
            className="font-semibold text-ink-500 hover:text-brand-700"
            aria-label={`${t("pr.price.change")}: ${name}`}
          >
            {t("pr.price.change")}
          </button>
        </p>
      )}
      {open && (
        <form
          className="mt-1 flex flex-col gap-2 rounded-lg bg-surface-alt p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-ink-900">
              {t("pr.price.label")} – {name}
            </span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={field}>
              <option value="case">{caseText}</option>
              {lists.map((list) => (
                <optgroup key={list} label={list}>
                  {choices.choices.map((c, i) =>
                    c.list === list ? (
                      <option key={c.label} value={`c${i}`}>
                        {c.label.split(" · ")[0]} – {kr(c.rate)}
                      </option>
                    ) : null,
                  )}
                </optgroup>
              ))}
              <option value="manual">{t("pr.price.manualOption")}</option>
            </select>
          </label>
          {pick === "manual" && (
            <label className="flex flex-col gap-1">
              <span className="font-semibold text-ink-900">{t("pr.price.manualField")}</span>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                inputMode="decimal"
                className={field}
                // biome-ignore lint/a11y/noAutofocus: shown because the user picked "Anden pris"
                autoFocus
              />
            </label>
          )}
          <p className="text-ink-500">{t("pr.price.hint")}</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {t("common.save")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-danger">
              ⚠ {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
