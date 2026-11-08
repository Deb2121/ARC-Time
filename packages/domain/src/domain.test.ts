import { describe, expect, it } from "vitest";
import {
  addDays,
  completionBasisPoints,
  dailyNorm,
  danishPublicHolidays,
  easterSunday,
  FULL_TIME_37,
  flexBalance,
  formatHours,
  formatMinor,
  type HolidayKind,
  hoursTimesRate,
  isOnStep,
  isoWeek,
  kr,
  type NormContext,
  parseHours,
  recognisedRevenue,
  roundToStep,
  startOfIsoWeek,
  weeklyFlex,
  weeklyNorm,
} from "./index.ts";

function ctx(holidays: Record<string, HolidayKind> = {}, start = "2020-01-01", end?: string): NormContext {
  return {
    assignments: [{ validFrom: "2020-01-01", pattern: FULL_TIME_37 }],
    holidays: new Map(Object.entries(holidays)),
    employment: { start, end },
  };
}

function danishHolidayMap(year: number): Record<string, HolidayKind> {
  return Object.fromEntries(danishPublicHolidays(year).map((h) => [h.date, { kind: "full" } as const]));
}

describe("hours", () => {
  it("parses Danish, English and hh:mm input", () => {
    expect(parseHours("1,5")).toBe(150);
    expect(parseHours("1.5")).toBe(150);
    expect(parseHours("1:30")).toBe(150);
    expect(parseHours("7,25")).toBe(725);
    expect(parseHours("8")).toBe(800);
    expect(() => parseHours("abc")).toThrow();
    expect(() => parseHours("")).toThrow();
  });
  it("enforces the 0,25 h step and rounds timer values to nearest quarter", () => {
    expect(isOnStep(725)).toBe(true);
    expect(isOnStep(710)).toBe(false);
    expect(roundToStep(112)).toBe(100); // 1 h 7 min
    expect(roundToStep(113)).toBe(125); // tie rounds up
  });
  it("formats with comma in Danish", () => {
    expect(formatHours(750)).toBe("7,50");
    expect(formatHours(-50)).toBe("-0,50");
    expect(formatHours(750, "en")).toBe("7.50");
  });
});

describe("money", () => {
  it("multiplies hours by rate in øre without floats", () => {
    expect(hoursTimesRate(750, kr(925))).toBe(kr(6937.5));
    expect(hoursTimesRate(25, kr(999.99))).toBe(25000); // 249,9975 → 250,00
  });
  it("formats Danish amounts", () => {
    expect(formatMinor(kr(117600)).replace(/\s/g, "")).toBe("117.600,00");
  });
});

describe("dates", () => {
  it("computes ISO weeks across year boundaries", () => {
    expect(isoWeek("2026-01-01")).toEqual({ year: 2026, week: 1 });
    expect(isoWeek("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
    expect(startOfIsoWeek("2026-11-08")).toBe("2026-11-02");
  });
});

describe("Danish public holidays", () => {
  it("computes Easter", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
  });
  it("has Ascension 14 May 2026 and no Store bededag from 2024", () => {
    const dates = danishPublicHolidays(2026).map((h) => h.date);
    expect(dates).toContain("2026-05-14");
    expect(danishPublicHolidays(2026).some((h) => h.key === "holiday.greatPrayerDay")).toBe(false);
    expect(danishPublicHolidays(2023).some((h) => h.key === "holiday.greatPrayerDay")).toBe(true);
  });
});

describe("norm hours", () => {
  it("default pattern is 37 h per week", () => {
    expect(weeklyNorm("2026-11-02", ctx())).toBe(3700);
  });
  it("§9: a public holiday on a Wednesday lowers the norm to 29,5 h", () => {
    // 1 Jan 2025 (Nytårsdag) is a Wednesday; ISO week 1 2025 starts Mon 30 Dec 2024
    expect(weeklyNorm("2024-12-30", ctx(danishHolidayMap(2025)))).toBe(2950);
  });
  it("half-day holiday halves that day's norm", () => {
    expect(dailyNorm("2026-06-05", ctx({ "2026-06-05": { kind: "half" } }))).toBe(350); // Friday 7,0 → 3,5
  });
  it("prorates by employment start and end", () => {
    expect(weeklyNorm("2026-11-02", ctx({}, "2026-11-04"))).toBe(750 + 750 + 700); // starts Wednesday
    expect(weeklyNorm("2026-11-02", ctx({}, "2020-01-01", "2026-11-03"))).toBe(1500);
  });
  it("uses the norm assignment valid on each date", () => {
    const c = ctx();
    c.assignments.push({
      validFrom: "2026-11-05",
      pattern: { cycleWeeks: 1, days: [600, 600, 600, 600, 600, 0, 0] },
    });
    expect(weeklyNorm("2026-11-02", c)).toBe(750 * 3 + 600 + 600);
  });
  it("supports 2-week cycles", () => {
    const pattern = {
      cycleWeeks: 2 as const,
      days: [800, 800, 800, 800, 800, 0, 0, 800, 800, 800, 800, 0, 0, 0],
    };
    const c: NormContext = { ...ctx(), assignments: [{ validFrom: "2026-11-02", pattern }] };
    expect(weeklyNorm("2026-11-02", c)).toBe(4000);
    expect(weeklyNorm(addDays("2026-11-02", 7), c)).toBe(3200);
    expect(weeklyNorm(addDays("2026-11-02", 14), c)).toBe(4000);
  });
});

describe("flex", () => {
  it("§9: 37,5 h registered against 37 h norm gives flex +0,5", () => {
    expect(weeklyFlex({ normHours: 3700, workHours: 3750, countingAbsenceHours: 0 })).toBe(50);
  });
  it("counting absence fills the norm; balance accumulates from opening", () => {
    const weeks = [
      { normHours: 3700, workHours: 2950, countingAbsenceHours: 750 }, // one vacation day → 0
      { normHours: 2950, workHours: 3200, countingAbsenceHours: 0 }, // holiday week, +2,5
    ];
    expect(flexBalance(-100, weeks)).toBe(150);
  });
});

describe("fixed-price completion", () => {
  it("§9: 240.000 kr with 98 of 200 budget hours → 49 % → 117.600 kr recognised", () => {
    const bp = completionBasisPoints(9800, 20000);
    expect(bp).toBe(4900);
    expect(recognisedRevenue(kr(240000), bp)).toBe(kr(117600));
  });
  it("caps at 100 % and honours a PM override", () => {
    expect(completionBasisPoints(25000, 20000)).toBe(10_000);
    expect(completionBasisPoints(9800, 20000, 6000)).toBe(6000);
    expect(() => completionBasisPoints(1, 1, 10_001)).toThrow();
  });
});
