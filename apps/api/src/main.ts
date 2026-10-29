import 'reflect-metadata';
import { API_PREFIX } from '@ultimate-erp/contracts';
import { Logger } from 'nestjs-pino';
import { createApp } from './bootstrap.js';
import { ConfigError, loadConfig } from './platform/config/config.js';
import { initMonitoring } from './platform/monitoring/monitoring.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  initMonitoring(config, 'api');
  const app = await createApp(config);
  await app.listen(config.API_PORT, config.API_HOST);
  app
    .get(Logger)
    .log(`API listening on http://${config.API_HOST}:${config.API_PORT}/${API_PREFIX}`);
}

main().catch((err: unknown) => {
  // Config errors are expected operator mistakes: print the list, no stack trace.
  const message = err instanceof ConfigError ? err.message : err;
  process.stderr.write(`API failed to start: ${String(message)}\n`);
  if (!(err instanceof ConfigError) && err instanceof Error && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
