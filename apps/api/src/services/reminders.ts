/**
 * Weekly e-mail reminders (brief §4.6 "reminders") — GRASP Pure Fabrication + Indirection: a job that, on Monday
 * mornings (Europe/Copenhagen), reminds employees who have not submitted last week and approvers who have
 * timesheets waiting. Sending goes through a `Mailer` so tests and local runs never e-mail anyone; with no SMTP
 * configured the job does nothing. Each reminder is logged once (reminder_log), so restarts never duplicate mails.
 */
import { type Db, schema, type Tx, withTenant } from "@arc-tid/db";
import { addDays, dailyNorm, type LocalDate, startOfIsoWeek, todayCopenhagen } from "@arc-tid/domain";
import { eq, inArray, sql } from "drizzle-orm";
import { loadEmployee, normContext } from "./calendar.ts";

/** Minimal mail-sending interface (nodemailer in production, a fake in tests). */
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Builds an SMTP mailer from env (SMTP_HOST/SMTP_PORT/MAIL_FROM), or null when not configured — the default. */
export async function mailerFromEnv(env: Record<string, string | undefined>): Promise<Mailer | null> {
  if (!env.SMTP_HOST) return null;
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? 1025),
    secure: false,
  });
  const from = env.MAIL_FROM ?? "ARCnordic Tid <noreply@arcnordic.test>";
  return { send: async (to, subject, text) => void (await transport.sendMail({ from, to, subject, text })) };
}

/** True from Monday 09:00 Copenhagen time until the end of Monday — the window the weekly job may run in. */
export function isReminderWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Mon" && hour >= 9;
}

/** Inserts a log row; returns false when this reminder was already sent (unique user/kind/ref). */
async function claimReminder(
  tx: Tx,
  tenantId: string,
  userId: string,
  kind: string,
  ref: string,
): Promise<boolean> {
  const rows = await tx
    .insert(schema.reminderLog)
    .values({ tenantId, userId, kind, ref })
    .onConflictDoNothing()
    .returning({ id: schema.reminderLog.id });
  return rows.length > 0;
}

/** Sends this week's reminders for one tenant; returns how many e-mails were sent. */
export async function sendTenantReminders(
  tx: Tx,
  tenantId: string,
  mailer: Mailer,
  today: LocalDate,
): Promise<number> {
  const lastMonday = addDays(startOfIsoWeek(today), -7);
  const people = await tx.select().from(schema.users).where(eq(schema.users.active, true));
  const periods = await tx
    .select()
    .from(schema.timesheetPeriods)
    .where(eq(schema.timesheetPeriods.weekStart, lastMonday));
  let sent = 0;
  for (const u of people) {
    const status = periods.find((p) => p.userId === u.id)?.status ?? "open";
    if (status !== "open") continue;
    const emp = await loadEmployee(tx, u.id);
    if (!emp) continue;
    const ctx = await normContext(tx, emp);
    let norm = 0;
    for (let d = 0; d < 7; d++) norm += dailyNorm(addDays(lastMonday, d), ctx);
    if (norm === 0 || !(await claimReminder(tx, tenantId, u.id, "submit_week", lastMonday))) continue;
    await mailer.send(
      u.email,
      "Husk at indsende din ugeseddel",
      `Hej ${u.fullName.split(" ")[0]}\n\nDin ugeseddel for ugen der startede ${lastMonday} er ikke indsendt endnu.\nÅbn ARCnordic Tid → Min uge, og tryk "Indsend uge".\n\nVenlig hilsen\nARCnordic Tid`,
    );
    sent++;
  }
  // Approvers with weeks waiting (direct reports' submitted periods).
  const waiting = await tx.execute<{ manager_id: string; n: number }>(sql`
    select u.manager_id, count(*)::int as n from timesheet_periods p join users u on u.id = p.user_id
    where p.status = 'submitted' and u.manager_id is not null group by u.manager_id`);
  const managers = waiting.length
    ? await tx
        .select()
        .from(schema.users)
        .where(
          inArray(
            schema.users.id,
            waiting.map((w) => w.manager_id),
          ),
        )
    : [];
  for (const w of waiting) {
    const m = managers.find((x) => x.id === w.manager_id);
    if (!m?.active || !(await claimReminder(tx, tenantId, m.id, "approve_timesheets", lastMonday))) continue;
    await mailer.send(
      m.email,
      "Ugesedler venter på din godkendelse",
      `Hej ${m.fullName.split(" ")[0]}\n\n${w.n} ugesedler venter på din godkendelse.\nÅbn ARCnordic Tid → Godkendelse.\n\nVenlig hilsen\nARCnordic Tid`,
    );
    sent++;
  }
  return sent;
}

/** Runs the weekly reminders for every tenant if we are in the Monday window and a mailer is configured. */
export async function runWeeklyReminders(
  db: Db,
  mailer: Mailer | null,
  now: Date = new Date(),
): Promise<number> {
  if (!mailer || !isReminderWindow(now)) return 0;
  const tenants = await db.execute<{ id: string }>(sql`select id from job_tenant_ids()`);
  let sent = 0;
  for (const t of tenants)
    sent += await withTenant(db, t.id, (tx) => sendTenantReminders(tx, t.id, mailer, todayCopenhagen(now)));
  return sent;
}
