import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const DOM_TESTS = ["tests/unit/dom/**/*.test.{ts,tsx}", "tests/unit/ui/**/*.test.{ts,tsx}"];

/**
 * Per-folder coverage thresholds (`npm run test:cov`). They start switched off;
 * M1-GATE turns them on by flipping `enforceThresholds` (or CI sets COVERAGE_THRESHOLDS=1).
 * Add folders here as their owners reach their targets.
 */
const enforceThresholds = process.env.COVERAGE_THRESHOLDS === "1";
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
