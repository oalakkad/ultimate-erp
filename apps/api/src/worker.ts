import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import { ConfigError, loadConfig } from './platform/config/config.js';
import { createWorker } from './worker-bootstrap.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const worker = await createWorker(config);
  worker.get(Logger).log('Worker started: processing background jobs');
}

main().catch((err: unknown) => {
  const message = err instanceof ConfigError ? err.message : err;
  process.stderr.write(`Worker failed to start: ${String(message)}\n`);
  if (!(err instanceof ConfigError) && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
