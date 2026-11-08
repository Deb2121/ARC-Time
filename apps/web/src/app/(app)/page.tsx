"use client";

import { danishPublicHolidays, isoWeek, todayCopenhagen } from "@arc-tid/domain";
import { Badge, Card } from "@arc-tid/ui";
import { useMe } from "@/components/session";
import { useI18n } from "@/i18n";

export default function HomePage() {
  const me = useMe();
  const { t, locale } = useI18n();
  const today = todayCopenhagen();
  const { week, year } = isoWeek(today);
  const nextHoliday = danishPublicHolidays(Number(today.slice(0, 4)))
    .concat(danishPublicHolidays(Number(today.slice(0, 4)) + 1))
    .find((h) => h.date >= today);
  const fmt = new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header>
        <p className="text-sm text-ink-500">
          {fmt.format(new Date(`${today}T12:00:00`))} · {locale === "da" ? "uge" : "week"} {week}, {year}
        </p>
        <h1 className="mt-1 text-3xl font-normal">
          {t("home.greeting", { name: me.fullName.split(" ")[0] ?? "" })}
        </h1>
        <p className="mt-2 text-ink-700">{t("home.intro")}</p>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        <Card title={t("home.week")} className="md:col-span-2">
          <p className="text-sm text-ink-500">{t("home.weekEmpty")}</p>
        </Card>
        <Card title={t("home.roles")}>
          <ul className="flex flex-wrap gap-2">
            {me.roles.map((r) => (
              <li key={r}>
                <Badge tone={r === "employee" ? "neutral" : "brand"}>{t(`role.${r}`)}</Badge>
              </li>
            ))}
          </ul>
          {nextHoliday && (
            <p className="mt-4 border-t border-line pt-3 text-sm text-ink-700">
              {locale === "da" ? "Næste helligdag" : "Next public holiday"}:{" "}
              <strong className="font-semibold text-ink-900">{nextHoliday.nameDa}</strong>{" "}
              {fmt.format(new Date(`${nextHoliday.date}T12:00:00`))}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
