import { defineConfig, devices } from "@playwright/test";

// Run through `npm run test:e2e` (scripts/e2e.ts), which prepares a throwaway, seeded database.
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  // Tests share one database, so they run in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // The dev server compiles each page on first visit, which can take several seconds.
  expect: { timeout: 15_000 },
  // Several sign-ins and first-visit compiles can exceed the 30 s default on the dev server.
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      // Office laptop screen (CLAUDE.md definition of done).
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
  ],
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
