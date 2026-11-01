import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure logic (API client, stores, parsing). Screens are exercised in
// the browser preview (apps/web/e2e/mobile-web.spec.ts) and on devices.
export default defineConfig({
  test: { include: ['test/**/*.spec.ts'], environment: 'node' },
});
