import { describe, expect, it } from "vitest";
import { accrualPostings, type LeavePosting, leaveDays, monthAccrual, runningBalance } from "./index.ts";

describe("monthly accrual", () => {
  it("a full month gives the full rate", () => {
    expect(monthAccrual(2026, 4, "2020-01-01", undefined, 208)).toBe(208);
  });
  it("a part month is pro rata over 30 days: from 16 March → 1,11", () => {
    expect(monthAccrual(2026, 3, "2026-03-16", undefined, 208)).toBe(111);
  });
  it("never more than the full rate, and nothing outside employment", () => {
    expect(monthAccrual(2026, 3, "2026-03-01", undefined, 208)).toBe(208);
    expect(monthAccrual(2026, 2, "2026-03-16", undefined, 208)).toBe(0);
    expect(monthAccrual(2026, 9, "2020-01-01", "2026-08-31", 208)).toBe(0);
  });
  it("the last month is pro rata too: leaving 15 June → 2,08 × 15 ÷ 30 = 1,04", () => {
    expect(monthAccrual(2026, 6, "2020-01-01", "2026-06-15", 208)).toBe(104);
  });
  it("feriefridage at an individual rate: ½ day a month", () => {
    expect(monthAccrual(2026, 5, "2020-01-01", undefined, 50)).toBe(50);
  });
});

describe("the real account from TimeLog (control)", () => {
  // Employed 16 March 2026; accrual posted at each month end through October; 11 vacation days in July.
  const accruals = accrualPostings("2025-06-30", "2026-11-17", "2026-03-16", undefined, 208);
  const taken: LeavePosting[] = [
    "2026-07-10",
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-23",
    "2026-07-24",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
  ].map((date) => ({ date, kind: "taken" as const, text: "03 - Ferie", days: -100 }));
  const lines = runningBalance(0, [...accruals, ...taken]);

  it("posts 1,11 in March and 2,08 in each of April–October", () => {
    expect(accruals.map((a) => [a.date, a.days])).toEqual([
      ["2026-03-31", 111],
      ["2026-04-30", 208],
      ["2026-05-31", 208],
      ["2026-06-30", 208],
      ["2026-07-31", 208],
      ["2026-08-31", 208],
      ["2026-09-30", 208],
      ["2026-10-31", 208],
    ]);
  });
  it("1,11 + 7 × 2,08 = 15,67 earned, 11 days taken, balance 4,67", () => {
    expect(accruals.reduce((a, p) => a + p.days, 0)).toBe(1567);
    expect(lines.at(-1)?.balance).toBe(467);
  });
  it("on 31 July the accrual comes before the vacation day", () => {
    const july31 = lines.filter((l) => l.date === "2026-07-31");
    expect(july31.map((l) => l.kind)).toEqual(["accrual", "taken"]);
  });
  it("running it again for the same period gives the same postings (never twice)", () => {
    expect(accrualPostings("2025-06-30", "2026-11-17", "2026-03-16", undefined, 208)).toEqual(accruals);
  });
  it("a month is only posted once it has ended", () => {
    expect(accrualPostings("2026-11-01", "2026-11-29", "2020-01-01", undefined, 208)).toEqual([]);
    expect(accrualPostings("2026-11-01", "2026-11-30", "2020-01-01", undefined, 208)).toHaveLength(1);
  });
});

describe("leave taken in days", () => {
  it("a full day of 7,5 t = 1 day; 3,75 t = ½ day; Friday 7 t = 1 day", () => {
    expect(leaveDays(750, 750)).toBe(100);
    expect(leaveDays(375, 750)).toBe(50);
    expect(leaveDays(700, 700)).toBe(100);
  });
});
