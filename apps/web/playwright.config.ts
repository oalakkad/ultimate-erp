import { defineConfig, devices } from '@playwright/test';

// Browser tests (docs/testing.md).
// - `pnpm e2e` (project "ui"): screens that need no API; starts the web dev server itself.
// - `pnpm e2e:journey` (project "journey"): the full first-day journey against the real dev
//   stack: run `pnpm dev` first (API, database and Mailpit).
// - `pnpm deploy:verify` (project "deployed"): the same journey against the production
//   containers behind HTTPS (E2E_WEB_URL, e.g. https://verify.test:8443). Chromium resolves the
//   test domain to this machine and accepts the throwaway certificate of the test proxy only.
const deployedUrl = process.env.E2E_WEB_URL;
const deployedDomain = deployedUrl ? new URL(deployedUrl).hostname : 'verify.test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: deployedUrl ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'ui', testIgnore: /journey/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'journey',
      testMatch: /journey\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      // The dev server transforms every source module on each full page load and proxies the
      // API through the same process, so screens take seconds to appear. The "deployed" project
      // keeps the strict 5 s default against the production build.
      expect: { timeout: 15_000 },
    },
    {
      name: 'deployed',
      testMatch: /journey\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        ignoreHTTPSErrors: true,
        launchOptions: {
          args: [
            `--host-resolver-rules=MAP ${deployedDomain} 127.0.0.1, MAP *.${deployedDomain} 127.0.0.1`,
          ],
        },
      },
    },
  ],
  // The deployed target serves the built app itself; no dev server.
  ...(deployedUrl
    ? {}
    : {
        webServer: {
          command: 'pnpm exec vite --port 5173 --strictPort',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
