import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 30_000,
    // Starting a throwaway Postgres container can take a while on first run.
    hookTimeout: 180_000,
  },
});
