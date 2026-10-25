import { defineConfig } from 'drizzle-kit';

// Used only by `pnpm --filter @ultimate-erp/db generate` to create SQL migrations
// from the TypeScript schema. Security (roles, RLS, grants) lives in custom SQL migrations.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
});
