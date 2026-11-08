import { describe, expect, it } from "vitest";
import { roundToQuarter, splitEventByDay } from "./index.ts";

const ev = (start: string, end: string, extra: Partial<Parameters<typeof splitEventByDay>[0]> = {}) => ({
  id: "e1",
  subject: "Byggemøde",
  start,
  end,
  isAllDay: false,
  showAs: "busy",
  ...extra,
});

describe("calendar import", () => {
  it("rounds to the nearest 0,25 h, never below 0,25 h", () => {
    expect(roundToQuarter(50)).toBe(75); // 50 min → 0,75 h
    expect(roundToQuarter(5)).toBe(25);
    expect(roundToQuarter(0)).toBe(0);
  });

  it("a 09:00–10:30 meeting becomes 1,5 h on that day", () => {
    expect(splitEventByDay(ev("2026-11-02T09:00:00.0000000", "2026-11-02T10:30:00.0000000"))).toEqual([
      { eventId: "e1", subject: "Byggemøde", date: "2026-11-02", from: "09:00", to: "10:30", hours: 150 },
    ]);
  });

  it("splits an event across midnight per day", () => {
    const parts = splitEventByDay(ev("2026-11-02T22:00:00", "2026-11-03T01:00:00"));
    expect(parts.map((p) => [p.date, p.hours])).toEqual([
      ["2026-11-02", 200],
      ["2026-11-03", 100],
    ]);
  });

  it("ignores all-day, free and cancelled events", () => {
    expect(splitEventByDay(ev("2026-11-02T00:00:00", "2026-11-03T00:00:00", { isAllDay: true }))).toEqual([]);
    expect(splitEventByDay(ev("2026-11-02T09:00:00", "2026-11-02T10:00:00", { showAs: "free" }))).toEqual([]);
    expect(splitEventByDay(ev("2026-11-02T09:00:00", "2026-11-02T10:00:00", { isCancelled: true }))).toEqual(
      [],
    );
  });
});
