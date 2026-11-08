/**
 * Vitest configuration for the API integration tests. The test files share one seeded database (and the invoice
 * number series), so they run one file at a time to keep assertions like "next invoice number" deterministic.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { fileParallelism: false },
});
