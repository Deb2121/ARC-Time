/**
 * Process entry point for the API (`pnpm dev` / `pnpm start`): builds the app, listens on API_PORT, runs the
 * outbox delivery loop every 30 s, weekly reminders, a daily retention sweep, and shuts down cleanly on SIGINT/SIGTERM.
 */
import { createDb } from "@arc-tid/db";
import { economicFromEnv } from "@arc-tid/integrations";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { runRetentionSweep } from "./services/gdpr.ts";
import { processOutbox } from "./services/outbox.ts";
import { mailerFromEnv, runWeeklyReminders } from "./services/reminders.ts";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const app = await buildApp(config, db);

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.API_PORT, host: "0.0.0.0" });

// Outbox delivery every 30 s. e-conomic stays disabled unless sandbox tokens are configured (brief §1).
const accounting = economicFromEnv(process.env);
app.log.info(
  accounting ? "e-conomic adapter configured (sandbox only)" : "no accounting integration configured",
);
const timer = setInterval(() => {
  processOutbox(db, accounting, (m) => app.log.warn(m)).catch((e) => app.log.error(e));
}, 30_000);
timer.unref();

// Weekly reminders (Monday from 09:00 Copenhagen). Disabled unless SMTP_HOST is set — locally point it at Mailpit.
const mailer = await mailerFromEnv(process.env);
app.log.info(mailer ? "e-mail reminders enabled" : "e-mail reminders disabled (no SMTP_HOST)");
const reminderTimer = setInterval(() => {
  runWeeklyReminders(db, mailer)
    .then((n) => n && app.log.info(`sent ${n} reminders`))
    .catch((e) => app.log.error(e));
}, 15 * 60_000);
reminderTimer.unref();

// Retention sweep (D-026): removes short-lived personal data and logs what has passed bookkeeping retention.
// Runs shortly after start and then once a day.
const sweep = () =>
  runRetentionSweep(db)
    .then((r) => app.log.info({ retention: r }, "retention sweep done"))
    .catch((e) => app.log.error(e));
setTimeout(sweep, 60_000).unref();
setInterval(sweep, 24 * 3600_000).unref();
