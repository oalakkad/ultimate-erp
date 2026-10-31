import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { bootstrapDatabase, type DatabaseUrls, runMigrations } from '../admin.js';
import { DB_ROLES } from '../roles.js';

/** Same image as local development (infra/compose/compose.dev.yaml). */
export const POSTGRES_IMAGE = 'postgres:18.6-alpine';

export interface TestDatabase extends DatabaseUrls {
  /** Docker container ID, for tools that run inside it (`docker exec`), e.g. pg_dump. */
  containerId: string;
  stop(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** PostgreSQL server settings (`-c name=value`), e.g. for performance measurements. */
  serverSettings?: Record<string, string>;
}

function withUser(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

/**
 * Starts a throwaway PostgreSQL in Docker with no roles and no tables: a brand-new server, as a
 * restore or a first installation finds it. For tests only.
 */
export async function startEmptyTestDatabase(
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  const definition = new PostgreSqlContainer(POSTGRES_IMAGE);
  if (options.serverSettings) {
    const flags = Object.entries(options.serverSettings).flatMap(([k, v]) => ['-c', `${k}=${v}`]);
    definition.withCommand(['postgres', ...flags]);
  }
  const container: StartedPostgreSqlContainer = await definition.start();
  const adminUrl = container.getConnectionUri();
  return {
    adminUrl,
    migratorUrl: withUser(adminUrl, DB_ROLES.migrator, 'test-migrator-password'),
    appUrl: withUser(adminUrl, DB_ROLES.app, 'test-app-password'),
    containerId: container.getId(),
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Starts a throwaway PostgreSQL in Docker with roles bootstrapped and all migrations applied,
 * exactly like a real installation. For tests only.
 */
export async function startTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const database = await startEmptyTestDatabase(options);
  await bootstrapDatabase(database);
  await runMigrations(database.migratorUrl);
  return database;
}
