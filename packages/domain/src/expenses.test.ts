import { describe, expect, it } from "vitest";
import { billableAmount, expenseCost, kr, mileageAmount, vatSplit } from "./index.ts";

const rate2026 = { year: 2026, highRate: 394, lowRate: 228, thresholdKm: 20_000 }; // illustrative rates

describe("VAT split (Danish receipts are VAT-inclusive)", () => {
  it("25 % VAT on 1.250 kr gives 1.000 kr net + 250 kr VAT", () => {
    expect(vatSplit(kr(1250), 2500)).toEqual({
      gross: kr(1250),
      net: kr(1000),
      vat: kr(250),
      deductibleVat: kr(250),
      nonDeductibleVat: 0,
    });
  });
  it("representation: only 25 % of the VAT is deductible, the rest is cost", () => {
    const s = vatSplit(kr(1250), 2500, 2500);
    expect(s.deductibleVat).toBe(kr(62.5));
    expect(s.nonDeductibleVat).toBe(kr(187.5));
    expect(expenseCost(s)).toBe(kr(1187.5));
  });
  it("no VAT (e.g. foreign taxi without VAT)", () => {
    expect(vatSplit(kr(300), 0)).toMatchObject({ net: kr(300), vat: 0 });
  });
  it("rounds VAT to whole øre, net + VAT always equals gross", () => {
    const s = vatSplit(9999, 2500);
    expect(s.net + s.vat).toBe(9999);
  });
});

describe("billable expense", () => {
  it("adds markup on the net amount", () => {
    expect(billableAmount(kr(1000), 1000)).toBe(kr(1100));
    expect(billableAmount(kr(1000), 0)).toBe(kr(1000));
  });
});

describe("mileage allowance", () => {
  it("all at the high rate below the yearly threshold: 42,5 km × 3,94 = 167,45 kr", () => {
    expect(mileageAmount(42_500, 0, rate2026)).toBe(kr(167.45));
  });
  it("splits a trip that crosses 20.000 km in the year", () => {
    expect(mileageAmount(50_000, 19_980_000, rate2026)).toBe(kr(20 * 3.94 + 30 * 2.28));
  });
  it("all at the low rate once the threshold is passed", () => {
    expect(mileageAmount(10_000, 25_000_000, rate2026)).toBe(kr(22.8));
  });
});
