import { defineConfig, devices } from '@playwright/test';

// `pnpm e2e:mobile`: the mobile app's browser preview (apps/mobile exported for web and served by
// `expo serve` on port 8081) against the real dev stack — run `pnpm dev` first. The app talks to
// the API through the web dev server's /api proxy on port 5173, exactly like a phone would talk
// to the deployed address, with its auth state in the X-Auth-State header (docs/modules/mobile.md).
export default defineConfig({
  testDir: './e2e',
  testMatch: /mobile-web\.spec\.ts/,
  outputDir: './e2e/results',
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
    // The desktop engine is enough for the preview; the mobile viewport is what matters.
    isMobile: false,
    hasTouch: false,
  },
  expect: { timeout: 15_000 },
  webServer: [
    {
      // The app's server address in development: the web dev server proxies /api to the API.
      command: 'pnpm exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @ultimate-erp/mobile exec expo serve --port 8081',
      url: 'http://localhost:8081',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
