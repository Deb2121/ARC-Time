/**
 * CLI entry point: applies all SQL migrations in packages/db/drizzle as the owner role (`pnpm db:migrate`).
 * Generated migrations come from schema.ts (`pnpm --filter @arc-tid/db generate`); hand-written ones add RLS,
 * triggers and SECURITY DEFINER functions.
 */
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.ts";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const { db, close } = createDb(url, { max: 1 });
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
await close();
console.log("migrations applied");
