import { defineConfig, devices } from "@playwright/test";

const localWorkers = 1;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: process.env.CI ? 1 : localWorkers,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.E2E_RESULTS_FILE
    ? [
        ["line"],
        ["html", { open: "never" }],
        ["json", { outputFile: process.env.E2E_RESULTS_FILE }],
      ]
    : [
        ["line"],
        ["html", { open: "never" }],
      ],
  use: {
    baseURL: "http://localhost:3119",
    locale: "en-US",
    timezoneId: "America/New_York",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    navigationTimeout: 15_000,
    acceptDownloads: true,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "chromium-mobile",
      testMatch: /responsive-accessibility\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
