import { defineConfig } from 'vitest/config';

// `pnpm perf` only (docs/performance.md): the performance test is slow and needs Docker, so
// it is not part of `pnpm test`.
export default defineConfig({
  test: {
    include: ['test/perf/**/*.perf.ts'],
    testTimeout: 20 * 60_000,
    hookTimeout: 30 * 60_000,
    fileParallelism: false,
  },
});
