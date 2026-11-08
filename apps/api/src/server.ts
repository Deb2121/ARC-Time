/**
 * Process entry point for the API (`pnpm dev` / `pnpm start`): builds the app, listens on API_PORT, runs the
 * outbox delivery loop every 30 s, and shuts down cleanly on SIGINT/SIGTERM.
 */
import { createDb } from "@arc-tid/db";
import { economicFromEnv } from "@arc-tid/integrations";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { processOutbox } from "./services/outbox.ts";

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
