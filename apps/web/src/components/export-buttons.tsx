"use client";

/**
 * "Hent som Excel (.xlsx)" and "Hent som CSV" for a report (D-033). Excel is the readable file (column widths,
 * dates, totals); CSV is for importing into other systems, which the hint under the buttons explains.
 */
import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/da";

const base =
  "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border px-4 text-sm font-semibold";

/** Style for an extra download next to the export buttons (same height and shape as "Hent som CSV"). */
export const exportSecondary = `${base} border-line bg-surface text-ink-900 hover:bg-surface-alt`;

/**
 * @param href the download URL for a format
 * @param csvLabel text for the CSV button (default "Hent som CSV")
 * @param hint text under the buttons (default: CSV is for import, choose Excel to read)
 * @param children extra download links shown in the same row, after a thin divider (style: `exportSecondary`)
 * @param extraHint a second line under the buttons explaining the extra links
 * @param align "end" right-aligns buttons and hints (for a toolbar above a table)
 */
export function ExportButtons({
  href,
  csvLabel = "exp.csv",
  hint = "exp.hint",
  className = "",
  children,
  extraHint,
  align = "start",
}: {
  href: (format: "xlsx" | "csv") => string;
  csvLabel?: MessageKey;
  hint?: MessageKey;
  className?: string;
  children?: ReactNode;
  extraHint?: MessageKey;
  align?: "start" | "end";
}) {
  const { t } = useI18n();
  const end = align === "end";
  return (
    <div className={`flex flex-col gap-2 ${end ? "items-end text-right" : ""} ${className}`}>
      <div className={`flex flex-wrap items-center gap-2 ${end ? "justify-end" : ""}`}>
        <a
          href={href("xlsx")}
          className={`${base} border-brand-600 bg-brand-50 text-brand-700 hover:bg-brand-600 hover:text-white`}
        >
          ↓ {t("exp.xlsx")}
        </a>
        <a href={href("csv")} className={exportSecondary}>
          ↓ {t(csvLabel)}
        </a>
        {children && (
          <>
            <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />
            {children}
          </>
        )}
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-ink-500">
        <p>{t(hint)}</p>
        {extraHint && <p>{t(extraHint)}</p>}
      </div>
    </div>
  );
}

/** The query string with `format` set, leaving the original untouched. */
export function withFormat(qs: URLSearchParams | string, format: "xlsx" | "csv"): string {
  const q = new URLSearchParams(qs);
  q.set("format", format);
  return q.toString();
}
