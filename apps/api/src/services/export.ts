/**
 * One export for every report (D-033) — GRASP Pure Fabrication: a report describes its columns once and gets both a
 * readable Excel workbook (.xlsx) and a CSV for import into other systems from the same description.
 *
 * Excel: column widths from the longest value (8–60 characters), real dates (dd-mm-åååå), hours and amounts as
 * numbers with 2 decimals, project numbers/WBS/employee numbers as text (so "3.2" never turns into a date), a bold
 * frozen header row with autofilter, Danish values and an optional totals row (SUBTOTAL, so it follows the filter).
 * CSV: UTF-8 with BOM, `;` separator, decimal comma without thousands separator, dates dd-mm-åååå, CRLF.
 */
import ExcelJS from "exceljs";

/** How a column's values are shown and stored. */
export type ColumnKind =
  /** plain text, stored as text (also numbers that are really codes: project no., WBS, employee no.) */
  | "text"
  /** long free text: max 60 characters wide, wrapped */
  | "comment"
  /** ISO date string "2026-11-09" → a real Excel date */
  | "date"
  /** decimal hours (7.5) → 7,50 */
  | "hours"
  /** kroner (14500) → 14.500,00 */
  | "money"
  /** percent (49 = 49 %) → 49,0 % */
  | "percent"
  /** whole number */
  | "integer"
  /** boolean → Ja / Nej */
  | "yesno";

export type CellValue = string | number | boolean | null | undefined;

/** One column: its header, how it is formatted and how to read the value from a row. */
export interface Column<R> {
  header: string;
  kind: ColumnKind;
  value: (row: R) => CellValue;
  /** add this column to the totals row */
  total?: boolean;
}

/** A report ready for export. */
export interface ExportTable<R> {
  /** worksheet name, e.g. "Tidsregistreringer" */
  sheet: string;
  /** file name without extension, e.g. "ARCtime_tidsregistreringer_2026-09" */
  file: string;
  columns: Column<R>[];
  rows: R[];
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_TYPE = "text/csv; charset=utf-8";

/** Danish text for time-entry statuses (never the internal code). */
const ENTRY_STATUS_DA: Record<string, string> = {
  draft: "Kladde",
  submitted: "Indsendt",
  approved: "Godkendt",
  rejected: "Afvist",
  invoiced: "Faktureret",
};

/** Danish text for a time-entry status; unknown codes pass through unchanged. */
export const entryStatusDa = (status: string): string => ENTRY_STATUS_DA[status] ?? status;

const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

const fixed2 = (n: number) => {
  const [int = "0", dec = "00"] = Math.abs(n).toFixed(2).split(".");
  return { sign: n < 0 ? "-" : "", int, dec };
};

/** "2026-11-09" → "09-11-2026" (empty for no date). */
export function danishDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

/**
 * The value as a person reads it in Danish (used for CSV and for measuring column widths).
 * @param thousands use a thousands separator for amounts (Excel display), not in CSV (import-friendly)
 */
export function displayValue(kind: ColumnKind, v: CellValue, thousands = false): string {
  if (v === null || v === undefined || v === "") return "";
  switch (kind) {
    case "date":
      return danishDate(String(v));
    case "hours":
    case "money": {
      const { sign, int, dec } = fixed2(Number(v));
      const grouped = thousands && kind === "money" ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : int;
      return `${sign}${grouped},${dec}`;
    }
    case "percent":
      return `${Number(v).toFixed(1).replace(".", ",")} %`;
    case "integer":
      return String(Math.round(Number(v)));
    case "yesno":
      return v === true || v === "true" ? "Ja" : "Nej";
    default:
      return String(v);
  }
}

/**
 * Column width in Excel characters: the longest shown value or header + 2, at least 8 and at most 60.
 * @example columnWidth("Dato", ["09-11-2026"]) // 12
 */
export function columnWidth(header: string, shown: readonly string[]): number {
  let longest = header.length;
  for (const s of shown) {
    // a multi-line value is as wide as its longest line
    for (const line of s.split(/\r?\n/)) if (line.length > longest) longest = line.length;
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2));
}

const hasTotals = <R>(t: ExportTable<R>) => t.columns.some((c) => c.total);

/** Sum of a totals column (hours and money to 2 decimals). */
function columnSum<R>(t: ExportTable<R>, c: Column<R>): number {
  const sum = t.rows.reduce((a, r) => a + (Number(c.value(r)) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/** The report as CSV for import (UTF-8 with BOM, `;`, decimal comma, dd-mm-åååå, Danish values). */
export function exportCsv<R>(t: ExportTable<R>): string {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  const lines = [t.columns.map((c) => esc(c.header)).join(";")];
  for (const r of t.rows) lines.push(t.columns.map((c) => esc(displayValue(c.kind, c.value(r)))).join(";"));
  if (hasTotals(t))
    lines.push(
      t.columns
        .map((c, i) => (c.total ? displayValue(c.kind, columnSum(t, c)) : i === 0 ? "I alt" : ""))
        .join(";"),
    );
  return `﻿${lines.join("\r\n")}\r\n`;
}

const NUM_FMT: Partial<Record<ColumnKind, string>> = {
  text: "@",
  comment: "@",
  date: "dd-mm-yyyy",
  hours: "#,##0.00",
  money: "#,##0.00",
  percent: "0.0%",
  integer: "0",
};

/** The cell value Excel stores: real dates and numbers, text for codes, Ja/Nej for yes/no. */
function excelValue(kind: ColumnKind, v: CellValue): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  switch (kind) {
    case "date": {
      const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
      return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
    }
    case "hours":
    case "money":
    case "integer":
      return Number(v);
    case "percent":
      return Number(v) / 100;
    case "yesno":
      return displayValue("yesno", v);
    default:
      return String(v);
  }
}

/** Excel sheet names: max 31 characters, none of : \ / ? * [ ]. */
const sheetName = (s: string) => s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Data";

/** Column letter for a 1-based index (1 → A, 27 → AA). */
const colLetter = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/** The report as an Excel workbook (see the module comment for the layout). */
export async function exportXlsx<R>(t: ExportTable<R>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ARCtime";
  const ws = wb.addWorksheet(sheetName(t.sheet), { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = t.columns.map((c) => {
    const shown = t.rows.map((r) => displayValue(c.kind, c.value(r), true));
    if (c.total) shown.push(displayValue(c.kind, columnSum(t, c), true));
    return {
      header: c.header,
      width: columnWidth(c.header, shown),
      style: {
        numFmt: NUM_FMT[c.kind] ?? "General",
        alignment: { vertical: "top", wrapText: c.kind === "comment" },
      },
    };
  });
  for (const r of t.rows) ws.addRow(t.columns.map((c) => excelValue(c.kind, c.value(r))));

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBFBFBF" } } };
  });
  const last = t.rows.length + 1;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: t.columns.length } };

  if (hasTotals(t)) {
    // SUBTOTAL(109, …) sums only the rows left visible by the filter.
    const row = ws.addRow(
      t.columns.map((c, i) => {
        if (!c.total) return i === 0 ? "I alt" : null;
        const col = colLetter(i + 1);
        return { formula: `SUBTOTAL(109,${col}2:${col}${last})`, result: columnSum(t, c) };
      }),
    );
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin", color: { argb: "FF7F7F7F" } } };
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Sends a report as `.xlsx` or `.csv` with the right content type and file name. */
export async function exportFile<R>(
  t: ExportTable<R>,
  format: "csv" | "xlsx",
): Promise<{ type: string; filename: string; body: string | Buffer }> {
  return format === "xlsx"
    ? { type: XLSX_TYPE, filename: `${t.file}.xlsx`, body: await exportXlsx(t) }
    : { type: CSV_TYPE, filename: `${t.file}.csv`, body: exportCsv(t) };
}
