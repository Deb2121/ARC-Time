/**
 * Built-in Danish public holidays (docs/spec/organisation.md). Easter by the anonymous Gregorian algorithm.
 * Store bededag is generated only for years up to 2023 (abolished from 2024).
 */
import { addDays, type LocalDate } from "./dates.ts";

export interface HolidayDef {
  date: LocalDate;
  key: string; // i18n key
  nameDa: string;
}

export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function danishPublicHolidays(year: number): HolidayDef[] {
  const e = easterSunday(year);
  const list: HolidayDef[] = [
    { date: `${year}-01-01`, key: "holiday.newYear", nameDa: "Nytårsdag" },
    { date: addDays(e, -3), key: "holiday.maundyThursday", nameDa: "Skærtorsdag" },
    { date: addDays(e, -2), key: "holiday.goodFriday", nameDa: "Langfredag" },
    { date: e, key: "holiday.easterSunday", nameDa: "Påskedag" },
    { date: addDays(e, 1), key: "holiday.easterMonday", nameDa: "2. påskedag" },
    { date: addDays(e, 39), key: "holiday.ascension", nameDa: "Kristi himmelfartsdag" },
    { date: addDays(e, 49), key: "holiday.whitSunday", nameDa: "Pinsedag" },
    { date: addDays(e, 50), key: "holiday.whitMonday", nameDa: "2. pinsedag" },
    { date: `${year}-12-25`, key: "holiday.christmasDay", nameDa: "Juledag" },
    { date: `${year}-12-26`, key: "holiday.boxingDay", nameDa: "2. juledag" },
  ];
  if (year <= 2023) {
    list.push({ date: addDays(e, 26), key: "holiday.greatPrayerDay", nameDa: "Store bededag" });
  }
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

export interface CompanyDayDef extends HolidayDef {
  kind: "full" | "half";
}

/** Default extra company days off (decision D-013); tenants can change these per calendar. */
export function defaultCompanyDays(year: number): CompanyDayDef[] {
  return [
    { date: `${year}-06-05`, key: "holiday.constitutionDay", nameDa: "Grundlovsdag", kind: "half" },
    { date: `${year}-12-24`, key: "holiday.christmasEve", nameDa: "Juleaftensdag", kind: "full" },
    { date: `${year}-12-31`, key: "holiday.newYearsEve", nameDa: "Nytårsaftensdag", kind: "full" },
  ];
}
