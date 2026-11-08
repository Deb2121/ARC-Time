import { describe, expect, it } from "vitest";
import { billablePct, effectiveRate, kr, margin, utilisation } from "./index.ts";

/** Worked examples from docs/spec/reporting.md (R2–R6). The Python analytics service uses the same examples. */
describe("KPI definitions", () => {
  it("utilisation: 120 billable of 148 norm hours = 81,1 %", () => {
    expect(utilisation(12_000, 14_800)).toBe(8108);
    expect(utilisation(100, 0)).toBeNull();
  });
  it("billable %: 120 of 150 work hours = 80,0 %", () => {
    expect(billablePct(12_000, 15_000)).toBe(8000);
  });
  it("effective hourly rate: 114.000 kr for 120 h = 950 kr/h", () => {
    expect(effectiveRate(kr(114_000), 12_000)).toBe(kr(950));
  });
  it("contribution margin: 117.600 − 44.100 = 73.500 kr, 62,5 %", () => {
    expect(margin(kr(117_600), kr(44_100))).toEqual({ margin: kr(73_500), marginBp: 6250 });
  });
});
