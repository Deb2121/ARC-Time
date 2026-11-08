import { describe, expect, it } from "vitest";
import {
  importTemplate,
  mapImport,
  parseCsv,
  parseDate,
  parseNumber,
  parseYesNo,
  rolesOf,
  validateRow,
} from "./index.ts";

describe("data import", () => {
  it("parses Excel-style CSV: BOM, semicolons, quotes with ; and line breaks inside", () => {
    const rows = parseCsv('﻿navn;by\r\n"Holm; Søn & Co";"Aarhus\nC"\r\n\r\nFjordbyen;Vejle\r\n');
    expect(rows).toEqual([
      ["navn", "by"],
      ["Holm; Søn & Co", "Aarhus\nC"],
      ["Fjordbyen", "Vejle"],
    ]);
    expect(parseCsv("name,city\nA,B")).toEqual([
      ["name", "city"],
      ["A", "B"],
    ]);
  });

  it("reads Danish numbers, dates and yes/no", () => {
    expect(parseNumber("1.234,50")).toBe(1234.5);
    expect(parseNumber("950 kr.")).toBe(950);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNaN();
    expect(parseDate("01-12-2026")).toBe("2026-12-01");
    expect(parseDate("1.2.2027")).toBe("2027-02-01");
    expect(parseDate("31-02-2026")).toBeNull();
    expect(parseYesNo("Ja")).toBe(true);
    expect(parseYesNo("nej")).toBe(false);
    expect(parseYesNo("måske")).toBeUndefined();
  });

  it("maps Danish or English headers and reports missing required columns", () => {
    const m = mapImport("customers", [
      ["Kundenummer", "Navn", "Farve"],
      ["1001", "Fjordbyen", "blå"],
    ]);
    expect(m.rows[0]).toEqual({ line: 2, values: { number: "1001", name: "Fjordbyen" } });
    expect(m.unknownColumns).toEqual(["Farve"]);
    expect(mapImport("employees", [["email"]]).missingColumns).toEqual(["navn", "initialer", "ansat fra"]);
  });

  it("validates rows with readable error codes", () => {
    expect(validateRow("customers", { name: "A", cvr: "123" })).toEqual(["bad_cvr"]);
    expect(
      validateRow("projects", { name: "P", managerEmail: "x@y.dk", contractType: "byttehandel" }),
    ).toEqual(["bad_contractType"]);
    expect(
      validateRow("employees", { email: "x", fullName: "X", initials: "X", employmentStart: "2026-13-01" }),
    ).toEqual(["bad_email", "bad_employmentStart"]);
    expect(rolesOf("projektleder, Leder")).toEqual(["project_manager", "line_manager"]);
    expect(rolesOf("chef")).toBeNull();
  });

  it("templates round-trip through the parser and mapper", () => {
    for (const kind of ["customers", "projects", "employees"] as const) {
      const m = mapImport(kind, parseCsv(importTemplate(kind)));
      expect(m.missingColumns).toEqual([]);
      expect(m.unknownColumns).toEqual([]);
      expect(validateRow(kind, m.rows[0]?.values ?? {})).toEqual([]);
    }
  });
});
