// `pnpm db:migrate` — applies pending migrations as erp_migrator.
import { runMigrations } from '../admin.js';
import { readEnv, urls } from './env.js';
import { runCli } from './run.js';

const env = readEnv({ DATABASE_MIGRATOR_URL: urls.DATABASE_MIGRATOR_URL });
await runCli(async () => {
  await runMigrations(env.DATABASE_MIGRATOR_URL);
  process.stdout.write('Migrations applied.\n');
});
