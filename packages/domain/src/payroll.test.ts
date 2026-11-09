import { describe, expect, it } from "vitest";
import { absenceDayFraction, lateDeltas, PAYROLL_CSV_HEADER, payrollCsv } from "./index.ts";

/** Examples from docs/spec/payroll.md. */
describe("payroll export rules", () => {
  it("R2: vacation 7,5 + 7,5 + 7,0 h on norm 7,5/7,5/7,0 = 3,00 days", () => {
    const days = absenceDayFraction(750, 750) + absenceDayFraction(750, 750) + absenceDayFraction(700, 700);
    expect(days).toBe(300);
    expect(absenceDayFraction(375, 750)).toBe(50);
    expect(absenceDayFraction(750, 0)).toBe(0);
  });

  it("R7: late items are deltas against what locked runs exported", () => {
    const base = { userId: "u", salaryCodeId: "syg", month: "2027-03-01", amount: null };
    const out = lateDeltas(
      [{ ...base, quantity: 300, sourceCount: 3 }],
      [{ ...base, quantity: 200, sourceCount: 2 }],
    );
    expect(out).toEqual([{ ...base, quantity: 100, sourceCount: 1 }]);
    expect(
      lateDeltas([{ ...base, quantity: 200, sourceCount: 2 }], [{ ...base, quantity: 200, sourceCount: 2 }]),
    ).toEqual([]);
    // nothing exported for that month before → the late line keeps "no amount" (not 0,00 kr) — found by CI
    expect(lateDeltas([{ ...base, quantity: 100, sourceCount: 1 }], [])).toEqual([
      { ...base, quantity: 100, sourceCount: 1 },
    ]);
    // mileage keeps its amount
    const km = { ...base, salaryCodeId: "km" };
    expect(lateDeltas([{ ...km, quantity: 4_000, amount: 15_240, sourceCount: 1 }], [])[0]?.amount).toBe(
      15_240,
    );
    // a day removed after export → negative correction
    expect(lateDeltas([], [{ ...base, quantity: 100, sourceCount: 1 }])[0]?.quantity).toBe(-100);
  });

  it("R9: the generic CSV matches the spec's example row", () => {
    const csv = payrollCsv([
      {
        employeeNumber: "1042",
        employeeName: "Mette Holm",
        code: "FERIE",
        providerCode: "31",
        description: "Ferie",
        unit: "days",
        quantity: 300,
        amount: null,
        periodStart: "2027-03-01",
        periodEnd: "2027-03-31",
        originalPeriod: null,
        sourceCount: 3,
      },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(`﻿${PAYROLL_CSV_HEADER}`);
    expect(csv.split("\r\n")[1]).toBe("1042;Mette Holm;FERIE;31;Ferie;3,00;dage;;;2027-03-01;2027-03-31;;3");
  });

  it("R3: mileage line carries km and the reimbursement amount", () => {
    const csv = payrollCsv([
      {
        employeeNumber: "1042",
        employeeName: "Mette; Holm",
        code: "KØRSEL",
        providerCode: null,
        description: "Kørsel",
        unit: "km",
        quantity: 41_200,
        amount: 156_972,
        periodStart: "2027-03-01",
        periodEnd: "2027-03-31",
        originalPeriod: "2027-02",
        sourceCount: 4,
      },
    ]);
    expect(csv.split("\r\n")[1]).toBe(
      '1042;"Mette; Holm";KØRSEL;;Kørsel;412,00;km;;1569,72;2027-03-01;2027-03-31;2027-02;4',
    );
  });
});
