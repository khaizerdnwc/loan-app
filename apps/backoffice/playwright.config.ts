import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys. In the gate (scripts/verify/verify.sh, e2e stage) the API and the built
 * backoffice are started first and PLAYWRIGHT_BASE_URL points at them.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  // Serial on purpose: simulator modes are global state, and the failure journeys change them
  // (reset in afterEach). Parallel workers would leak an outage into other journeys.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
