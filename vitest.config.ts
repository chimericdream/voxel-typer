import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const DOM_TESTS = ["tests/unit/dom/**/*.test.{ts,tsx}", "tests/unit/ui/**/*.test.{ts,tsx}"];

/**
 * Per-folder coverage thresholds (`npm run test:cov`). M1-GATE switched them on for good.
 * Add folders here as their owners reach their targets.
 */
const enforceThresholds = true;

/**
 * True for `vitest run --coverage`. Instrumented code runs slower, so timing tests (the mesher
 * benchmark) read `VT_COVERAGE` and use their relaxed bound, as they do on CI.
 */
const coverageRun = process.argv.some(
  (arg) => arg === "--coverage" || arg.startsWith("--coverage."),
);
const folderThresholds: Record<string, { lines: number }> = {
  "src/engine/**": { lines: 95 },
};

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          exclude: DOM_TESTS,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: DOM_TESTS,
        },
      },
    ],
    passWithNoTests: true,
    env: coverageRun ? { VT_COVERAGE: "1" } : {},
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "html", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: enforceThresholds ? folderThresholds : {},
    },
  },
});
