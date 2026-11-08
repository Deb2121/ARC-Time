import { describe, expect, it } from "vitest";
import {
  accruedDays,
  budgetActual,
  dayAnomalies,
  defaultCompanyDays,
  type EntryCheck,
  holidayYearOf,
  kr,
  summariseWeek,
  validateEntry,
} from "./index.ts";

const base: EntryCheck = {
  hours: 750,
  date: "2026-11-04",
  today: "2026-11-08",
  otherHoursSameDay: 0,
  isAbsence: false,
  projectActive: true,
  taskOpen: true,
  commentRequired: false,
  comment: null,
  periodLocked: false,
};

describe("entry validation", () => {
  it("accepts a normal entry", () => {
    expect(validateEntry(base)).toEqual([]);
  });
  it("refuses more than 24 h on a day", () => {
    expect(validateEntry({ ...base, hours: 1000, otherHoursSameDay: 1500 })).toContain("day_over_24");
  });
  it("refuses hours off the 0,25 step", () => {
    expect(validateEntry({ ...base, hours: 710 })).toContain("hours_step");
  });
  it("refuses future work but allows future vacation", () => {
    expect(validateEntry({ ...base, date: "2026-11-10" })).toContain("future_date");
    expect(validateEntry({ ...base, date: "2026-12-21", isAbsence: true })).toEqual([]);
  });
  it("refuses closed projects and tasks", () => {
    expect(validateEntry({ ...base, projectActive: false, taskOpen: false })).toEqual([
      "project_inactive",
      "task_closed",
    ]);
  });
  it("requires a comment when the project demands it", () => {
    expect(validateEntry({ ...base, commentRequired: true, comment: "  " })).toContain("comment_required");
    expect(validateEntry({ ...base, commentRequired: true, comment: "Tegninger" })).toEqual([]);
  });
  it("§9: editing in a closed period is refused", () => {
    expect(validateEntry({ ...base, periodLocked: true })).toContain("period_locked");
  });
  it("approved entries are read-only for the employee", () => {
    expect(validateEntry({ ...base, currentStatus: "approved" })).toContain("not_editable");
    expect(validateEntry({ ...base, currentStatus: "rejected" })).toEqual([]);
  });
});

describe("week summary", () => {
  const norm = (d: string) => (["2026-11-07", "2026-11-08"].includes(d) ? 0 : d === "2026-11-06" ? 700 : 750);
  it("§9: 37,5 h registered against 37 h norm gives flex +0,5 and billable %", () => {
    const entries = [
      ...["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((date) => ({
        date,
        hours: 750,
        kind: "work" as const,
        billable: true,
      })),
      { date: "2026-11-06", hours: 750, kind: "work" as const, billable: false },
    ];
    const s = summariseWeek("2026-11-02", entries, norm);
    expect(s.normHours).toBe(3700);
    expect(s.workHours).toBe(3750);
    expect(s.flex).toBe(50);
    expect(s.billableBp).toBe(8000); // 30 of 37,5 h
  });
  it("vacation fills the norm; time off in lieu draws flex", () => {
    const s = summariseWeek(
      "2026-11-02",
      [
        { date: "2026-11-02", hours: 750, kind: "absence", countsTowardNorm: true },
        { date: "2026-11-03", hours: 750, kind: "absence", countsTowardNorm: false },
        ...["2026-11-04", "2026-11-05"].map((date) => ({ date, hours: 750, kind: "work" as const })),
        { date: "2026-11-06", hours: 700, kind: "work" as const },
      ],
      norm,
    );
    expect(s.flex).toBe(-750);
    expect(s.belowNorm).toBe(true);
  });
  it("flags days far over or under norm", () => {
    const s = summariseWeek("2026-11-02", [{ date: "2026-11-02", hours: 1100, kind: "work" }], norm);
    const flags = dayAnomalies(s.days);
    expect(flags[0]).toEqual({ date: "2026-11-02", kind: "over" });
    expect(flags.filter((f) => f.kind === "under")).toHaveLength(4);
  });
});

describe("vacation accrual", () => {
  it("knows the holiday year", () => {
    expect(holidayYearOf("2026-11-08")).toBe(2026);
    expect(holidayYearOf("2026-08-31")).toBe(2025);
  });
  it("accrues 2,08 days per month; full year = 24,96 days", () => {
    expect(accruedDays(2026, "2026-11-08", "2020-01-01")).toBe(3 * 208); // Sep, Oct, Nov
    expect(accruedDays(2025, "2026-08-31", "2020-01-01")).toBe(2496);
  });
  it("starts accruing in the month of employment", () => {
    expect(accruedDays(2025, "2026-08-31", "2026-03-15")).toBe(6 * 208); // Mar–Aug
  });
});

describe("budget vs actual", () => {
  it("computes consumption, remaining, margin and health", () => {
    const r = budgetActual({
      budgetHours: 40000,
      budgetAmount: kr(380000),
      usedHours: 31000,
      usedValue: kr(294500),
      usedCost: kr(139500),
    });
    expect(r.hoursConsumptionBp).toBe(7750);
    expect(r.remainingHours).toBe(9000);
    expect(r.contributionMargin).toBe(kr(155000));
    expect(r.marginBp).toBe(5263);
    expect(r.health).toBe("ok");
  });
  it("warns from 90 % and is over above 100 %", () => {
    const mk = (usedHours: number) =>
      budgetActual({ budgetHours: 10000, budgetAmount: 0, usedHours, usedValue: 0, usedCost: 0 }).health;
    expect(mk(8900)).toBe("ok");
    expect(mk(9000)).toBe("warning");
    expect(mk(10100)).toBe("over");
  });
});

describe("company days", () => {
  it("defaults: half Grundlovsdag, full 24 and 31 December", () => {
    expect(defaultCompanyDays(2026).map((d) => `${d.date}:${d.kind}`)).toEqual([
      "2026-06-05:half",
      "2026-12-24:full",
      "2026-12-31:full",
    ]);
  });
});
