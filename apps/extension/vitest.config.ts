import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.{ts,tsx}",
      "retailers/**/*.test.ts",
      "background/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      // Measure domain logic only. The React UI, the I/O boundary (IndexedDB,
      // the YNAB network client, chrome messaging, settings storage), trivial
      // registries, static content, and the DOM-scraping retailer adapters are
      // either presentational or only meaningfully exercised against live
      // pages/APIs — unit coverage there would be noise, not signal.
      include: ["lib/**", "background/**", "retailers/**"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/types.ts",
        "lib/db.ts",
        "lib/ynab.ts",
        "lib/messaging.ts",
        "lib/settings.ts",
        "lib/help-content.ts",
        "**/registry.ts",
        "retailers/*/adapter.ts",
      ],
      reporter: ["text-summary", "lcov"],
      // Thresholds sit just under current coverage so the bar ratchets up over
      // time without breaking the build on unrelated changes.
      thresholds: {
        lines: 78,
        statements: 76,
        functions: 75,
        branches: 62,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
