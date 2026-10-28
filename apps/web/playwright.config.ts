import { defineConfig, devices } from '@playwright/test';

// Browser tests (docs/testing.md).
// - `pnpm e2e` (project "ui"): screens that need no API; starts the web dev server itself.
// - `pnpm e2e:journey` (project "journey"): the full first-day journey against the real dev
//   stack — run `pnpm dev` first (API, database and Mailpit).
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'ui', testIgnore: /journey/, use: { ...devices['Desktop Chrome'] } },
    { name: 'journey', testMatch: /journey\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm exec vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
