import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

/** Same images as local development (infra/compose/compose.dev.yaml). */
const RUSTFS_IMAGE = 'rustfs/rustfs:1.0.3';
const CLAMAV_IMAGE = 'clamav/clamav:1.5.4-debian13-slim';

export const TEST_S3_ACCESS_KEY = 'test-access-key';
// Throwaway credentials for a container that exists only during the test run.
const TEST_S3_SECRET_KEY = 'testtesttesttest';

/** Real S3-compatible storage in Docker (RustFS). */
export async function startObjectStorage(): Promise<{
  config: Record<string, string>;
  stop(): Promise<void>;
}> {
  const container: StartedTestContainer = await new GenericContainer(RUSTFS_IMAGE)
    .withEnvironment({
      RUSTFS_ACCESS_KEY: TEST_S3_ACCESS_KEY,
      RUSTFS_SECRET_KEY: TEST_S3_SECRET_KEY,
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/health', 9000))
    .start();
  return {
    config: {
      S3_ENDPOINT: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      S3_ACCESS_KEY: TEST_S3_ACCESS_KEY,
      S3_SECRET_KEY: TEST_S3_SECRET_KEY,
      S3_BUCKET: 'test-files',
    },
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Real ClamAV in Docker. The image ships a virus database; loading it takes a minute or two,
 * and clamd only listens once it is loaded.
 */
export async function startClamav(): Promise<{
  host: string;
  port: number;
  stop(): Promise<void>;
}> {
  const container = await new GenericContainer(CLAMAV_IMAGE)
    .withEnvironment({ CLAMAV_NO_FRESHCLAMD: 'true' })
    .withExposedPorts(3310)
    .withWaitStrategy(Wait.forLogMessage(/socket found, clamd started/).withStartupTimeout(300_000))
    .start();
  return {
    host: container.getHost(),
    port: container.getMappedPort(3310),
    stop: async () => {
      await container.stop();
    },
  };
}
