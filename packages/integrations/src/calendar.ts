/**
 * Calendar adapter (docs/spec/integrations.md R6) — GRASP Polymorphism + Protected Variations: the app only knows
 * `CalendarSource`; Microsoft Graph is one implementation. Strictly read-only: it uses the delegated scope
 * `Calendars.Read` and only ever issues GET requests — nothing is written back to anyone's calendar.
 * Disabled by default: it only exists when Entra sign-in and GRAPH_CALENDAR_ENABLED are configured.
 */
import { IntegrationError } from "./adapter.ts";

/** A calendar event with local wall-clock times in Europe/Copenhagen ("YYYY-MM-DDTHH:mm:ss…"). */
export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  isAllDay: boolean;
  showAs: string;
  isCancelled: boolean;
  organizer: string | null;
}

/** Anything that can list a person's events between two dates (from inclusive, to exclusive, "YYYY-MM-DD"). */
export interface CalendarSource {
  readonly kind: string;
  listEvents(from: string, to: string): Promise<CalendarEvent[]>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Shape of one item from Graph `/me/calendarView` (only the fields we select). */
interface GraphEvent {
  id: string;
  subject?: string | null;
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay?: boolean;
  showAs?: string;
  isCancelled?: boolean;
  organizer?: { emailAddress?: { name?: string } } | null;
}

/** Maps a Graph event to our neutral shape (pure; tested without network). */
export function fromGraphEvent(e: GraphEvent): CalendarEvent {
  return {
    id: e.id,
    subject: e.subject?.trim() || "(uden emne)",
    start: e.start.dateTime,
    end: e.end.dateTime,
    isAllDay: Boolean(e.isAllDay),
    showAs: e.showAs ?? "busy",
    isCancelled: Boolean(e.isCancelled),
    organizer: e.organizer?.emailAddress?.name ?? null,
  };
}

/** Reads the signed-in user's calendar through Microsoft Graph with a delegated access token. */
export class GraphCalendarSource implements CalendarSource {
  readonly kind = "graph_calendar";

  /** @param accessToken delegated token with Calendars.Read; @param fetchImpl injectable for tests */
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = "https://graph.microsoft.com/v1.0",
  ) {}

  /** Lists events in [from, to) via calendarView (expands recurring meetings), following paging links. */
  async listEvents(from: string, to: string): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      startDateTime: `${from}T00:00:00`,
      endDateTime: `${to}T00:00:00`,
      $select: "id,subject,start,end,isAllDay,showAs,isCancelled,organizer",
      $orderby: "start/dateTime",
      $top: "100",
    });
    let url: string | undefined = `${this.baseUrl}/me/calendarView?${params}`;
    const out: CalendarEvent[] = [];
    for (let page = 0; url && page < 20; page++) {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          prefer: 'outlook.timezone="Europe/Copenhagen"',
        },
      });
      if (!res.ok) throw new IntegrationError(`graph ${res.status}`, res.status >= 500 || res.status === 429);
      const body = (await res.json()) as { value: GraphEvent[]; "@odata.nextLink"?: string };
      out.push(...body.value.map(fromGraphEvent));
      url = body["@odata.nextLink"];
    }
    return out;
  }
}
