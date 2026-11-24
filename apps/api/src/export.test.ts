/**
 * The shared report export (D-033): column widths, dates, codes as text, Danish values, totals, CSV for import.
 * Pure tests — no database.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  columnWidth,
  danishDate,
  displayValue,
  type ExportTable,
  entryStatusDa,
  exportCsv,
  exportXlsx,
} from "./services/export.ts";
import { periodLabel } from "./services/reports.ts";

interface Row {
  date: string;
  employee: string;
  wbs: string;
  hours: number;
  billable: boolean;
  status: string;
  comment: string | null;
}

const rows: Row[] = [
  {
    date: "2026-09-01",
    employee: "Ida Skov",
    wbs: "3.2",
    hours: 4.25,
    billable: true,
    status: "draft",
    comment: null,
  },
  {
    date: "2026-09-02",
    employee: "Emil Krogh",
    wbs: "4",
    hours: 7.5,
    billable: false,
    status: "approved",
    comment: "Møde med kommunen om dispensation",
  },
];
const table: ExportTable<Row> = {
  sheet: "Tidsregistreringer",
  file: "ARCtime_tidsregistreringer_2026-09",
  rows,
  columns: [
    { header: "Dato", kind: "date", value: (r) => r.date },
    { header: "Medarbejder", kind: "text", value: (r) => r.employee },
    { header: "WBS", kind: "text", value: (r) => r.wbs },
    { header: "Timer", kind: "hours", value: (r) => r.hours, total: true },
    { header: "Fakturerbar", kind: "yesno", value: (r) => r.billable },
    { header: "Status", kind: "text", value: (r) => entryStatusDa(r.status) },
    { header: "Kommentar", kind: "comment", value: (r) => r.comment },
  ],
};

async function readBack(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("no sheet");
  return ws;
}

describe("column width", () => {
  it("fits the longest value or header plus 2, between 8 and 60", () => {
    expect(columnWidth("Dato", ["09-11-2026"])).toBe(12);
    expect(columnWidth("WBS", ["3.2", "4"])).toBe(8);
    expect(columnWidth("Projektnavn", ["Søholm Friskole – nyt cykelskur"])).toBe(33);
    expect(columnWidth("Kommentar", ["x".repeat(200)])).toBe(60);
  });
});

describe("values", () => {
  it("formats Danish dates, hours, amounts and yes/no", () => {
    expect(danishDate("2026-09-01")).toBe("01-09-2026");
    expect(displayValue("hours", 4.25)).toBe("4,25");
    expect(displayValue("money", 14500)).toBe("14500,00");
    expect(displayValue("money", 14500, true)).toBe("14.500,00");
    expect(displayValue("money", -1234567.5, true)).toBe("-1.234.567,50");
    expect(displayValue("yesno", true)).toBe("Ja");
    expect(displayValue("yesno", false)).toBe("Nej");
  });
  it("translates time-entry statuses to Danish", () => {
    expect(["draft", "submitted", "approved", "invoiced", "rejected"].map(entryStatusDa)).toEqual([
      "Kladde",
      "Indsendt",
      "Godkendt",
      "Faktureret",
      "Afvist",
    ]);
  });
  it("names the file after the period: one whole month → 2026-09", () => {
    expect(periodLabel("2026-09-01", "2026-09-30")).toBe("2026-09");
    expect(periodLabel("2026-09-01", "2026-10-15")).toBe("2026-09-01_2026-10-15");
  });
});

describe("Excel workbook", () => {
  it("stores real dates, numbers, WBS as text, a frozen bold header, filter and a totals row", async () => {
    const ws = await readBack(await exportXlsx(table));
    expect(ws.name).toBe("Tidsregistreringer");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getRow(1).font?.bold).toBe(true);

    const date = ws.getCell("A2");
    expect(date.value).toBeInstanceOf(Date);
    expect((date.value as Date).toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(date.numFmt).toBe("dd-mm-yyyy");

    // WBS 3.2 and 4 are both text, so Excel never turns 3.2 into a date and both align the same way
    expect(ws.getCell("C2").value).toBe("3.2");
    expect(ws.getCell("C3").value).toBe("4");
    expect(ws.getCell("C2").numFmt).toBe("@");

    expect(ws.getCell("D2").value).toBe(4.25);
    expect(ws.getCell("D2").numFmt).toBe("#,##0.00");
    expect(ws.getCell("E2").value).toBe("Ja");
    expect(ws.getCell("F3").value).toBe("Godkendt");
    expect(ws.getCell("G3").alignment?.wrapText).toBe(true);

    // widths: no "#######" for dates, long names fully visible
    expect(ws.getColumn(1).width).toBeGreaterThanOrEqual(12);
    expect(ws.getColumn(2).width).toBe(columnWidth("Medarbejder", ["Ida Skov", "Emil Krogh"]));

    const total = ws.getCell("D4");
    expect(ws.getCell("A4").value).toBe("I alt");
    expect(total.value).toMatchObject({ formula: "SUBTOTAL(109,D2:D3)", result: 11.75 });
  });

  it("exports 10.000 rows in well under 5 seconds", async () => {
    const many = Array.from(
      { length: 10_000 },
      (_, i) => ({ ...rows[i % 2], employee: `Medarbejder ${i}` }) as Row,
    );
    const started = Date.now();
    const buf = await exportXlsx({ ...table, rows: many });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(buf.length).toBeGreaterThan(10_000);
  });
});

describe("CSV for import", () => {
  it("is UTF-8 with BOM, semicolons, decimal comma, Danish dates and values, and a totals line", () => {
    const csv = exportCsv(table);
    expect(csv.startsWith("﻿Dato;Medarbejder;WBS;Timer;Fakturerbar;Status;Kommentar\r\n")).toBe(true);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[1]).toBe("01-09-2026;Ida Skov;3.2;4,25;Ja;Kladde;");
    expect(lines[2]).toBe("02-09-2026;Emil Krogh;4;7,50;Nej;Godkendt;Møde med kommunen om dispensation");
    expect(lines[3]).toBe("I alt;;;11,75;;;");
  });
});
