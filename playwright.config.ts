import { defineConfig, devices } from "@playwright/test";

/** E2E tests. Expects the dev stack running: `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev`. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Specs share one seeded database and some of the same demo users, so run them one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
