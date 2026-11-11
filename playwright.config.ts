import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const isCI = !!process.env.CI;

/**
 * e2e runs against the `--mode test` build (dist-test/), served by `vite preview`.
 * - Screenshots are compared only on Linux CI or in `npm run e2e:docker` (both set CI=1).
 *   Baselines are made only by the Update snapshots workflow (docs/impl/README.md §3.7).
 * - E2E_SKIP_BUILD=1 serves an existing dist-test/ (for CI jobs that download the build artifact).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }], ["blob"]] : [["list"]],
  ignoreSnapshots: !isCI,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `npx vite preview --mode test --port ${PORT} --strictPort --host 127.0.0.1`
      : `npx vite build --mode test && npx vite preview --mode test --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
