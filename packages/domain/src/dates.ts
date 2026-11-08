/**
 * Local calendar dates as "YYYY-MM-DD" strings in the tenant time zone (Europe/Copenhagen).
 * Calculations use UTC internally so daylight-saving changes never shift a date.
 */
export type LocalDate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function toUtc(d: LocalDate): Date {
  const m = DATE_RE.exec(d);
  if (!m) throw new RangeError(`invalid date: ${d}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function fromUtc(dt: Date): LocalDate {
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtc(dt);
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(d: LocalDate): number {
  const wd = toUtc(d).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function startOfIsoWeek(d: LocalDate): LocalDate {
  return addDays(d, 1 - isoWeekday(d));
}

export function isoWeek(d: LocalDate): { year: number; week: number } {
  const thursday = addDays(d, 4 - isoWeekday(d));
  const year = toUtc(thursday).getUTCFullYear();
  const week1Monday = startOfIsoWeek(`${year}-01-04`);
  return { year, week: Math.floor(daysBetween(week1Monday, d) / 7) + 1 };
}

export function daysInRange(from: LocalDate, toInclusive: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= toInclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today's date in Europe/Copenhagen. */
export function todayCopenhagen(now: Date = new Date()): LocalDate {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(now);
}
