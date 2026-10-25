// `pnpm db:bootstrap` — creates/updates the database roles (dev). Idempotent.
import { bootstrapDatabase } from '../admin.js';
import { readEnv, urls } from './env.js';
import { runCli } from './run.js';

const env = readEnv(urls);
await runCli(async () => {
  await bootstrapDatabase({
    adminUrl: env.DATABASE_ADMIN_URL,
    migratorUrl: env.DATABASE_MIGRATOR_URL,
    appUrl: env.DATABASE_URL,
  });
  process.stdout.write('Database roles ready: erp_migrator, erp_app, erp_platform.\n');
});
