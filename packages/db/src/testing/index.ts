import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { bootstrapDatabase, type DatabaseUrls, runMigrations } from '../admin.js';
import { DB_ROLES } from '../roles.js';

/** Same image as local development (infra/compose/compose.dev.yaml). */
export const POSTGRES_IMAGE = 'postgres:18.6-alpine';

export interface TestDatabase extends DatabaseUrls {
  stop(): Promise<void>;
}

function withUser(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

/**
 * Starts a throwaway PostgreSQL in Docker with roles bootstrapped and all migrations applied,
 * exactly like a real installation. For tests only.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const adminUrl = container.getConnectionUri();
  const urls: DatabaseUrls = {
    adminUrl,
    migratorUrl: withUser(adminUrl, DB_ROLES.migrator, 'test-migrator-password'),
    appUrl: withUser(adminUrl, DB_ROLES.app, 'test-app-password'),
  };
  await bootstrapDatabase(urls);
  await runMigrations(urls.migratorUrl);
  return {
    ...urls,
    stop: async () => {
      await container.stop();
    },
  };
}
