import { describe, expect, it } from "vitest";
import { GraphCalendarSource } from "./calendar.ts";

describe("Graph calendar adapter (no network)", () => {
  it("reads calendarView read-only, in Copenhagen time, following paging", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const pages = [
      {
        value: [
          {
            id: "a",
            subject: "Byggemøde",
            start: { dateTime: "2026-11-02T09:00:00.0000000" },
            end: { dateTime: "2026-11-02T10:00:00.0000000" },
            showAs: "busy",
          },
        ],
        "@odata.nextLink": "https://graph.invalid/next",
      },
      {
        value: [
          {
            id: "b",
            subject: null,
            start: { dateTime: "2026-11-03T13:00:00" },
            end: { dateTime: "2026-11-03T14:00:00" },
            isAllDay: false,
          },
        ],
      },
    ];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
    };
    const events = await new GraphCalendarSource("token", fake, "https://graph.invalid").listEvents(
      "2026-11-02",
      "2026-11-09",
    );
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(events[1]?.subject).toBe("(uden emne)");
    expect(calls.every((c) => c.init.method === "GET")).toBe(true);
    expect(calls[0]?.url).toContain("/me/calendarView?startDateTime=2026-11-02T00%3A00%3A00");
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.prefer).toContain(
      "Europe/Copenhagen",
    );
  });

  it("treats 401 as non-retryable and 503 as retryable", async () => {
    const status = (s: number) => async () => new Response("{}", { status: s });
    await expect(
      new GraphCalendarSource("t", status(401)).listEvents("2026-11-02", "2026-11-09"),
    ).rejects.toMatchObject({ retryable: false });
    await expect(
      new GraphCalendarSource("t", status(503)).listEvents("2026-11-02", "2026-11-09"),
    ).rejects.toMatchObject({ retryable: true });
  });
});
