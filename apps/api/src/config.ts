/**
 * Environment configuration, validated with Zod at start-up (fails fast on missing/invalid values).
 * Derived flags: dev login can never be on in production; Entra ID is enabled only when all three values are set.
 */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  /** login attempts per minute per IP */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  DEV_LOGIN_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ENTRA_TENANT_ID: z.string().optional().default(""),
  ENTRA_CLIENT_ID: z.string().optional().default(""),
  ENTRA_CLIENT_SECRET: z.string().optional().default(""),
  ENTRA_REDIRECT_URI: z.string().optional().default(""),
});

export type Config = z.infer<typeof schema> & { entraEnabled: boolean; devLoginEnabled: boolean };

/** Loads .env from the repo root, applies overrides (used by tests) and returns the validated config. */
export function loadConfig(overrides: Record<string, string | undefined> = {}): Config {
  loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
  const parsed = schema.parse({ ...process.env, ...overrides });
  return {
    ...parsed,
    // Dev login can never be enabled in production, whatever the env says.
    devLoginEnabled: parsed.DEV_LOGIN_ENABLED && parsed.NODE_ENV !== "production",
    entraEnabled: Boolean(parsed.ENTRA_TENANT_ID && parsed.ENTRA_CLIENT_ID && parsed.ENTRA_CLIENT_SECRET),
  };
}
