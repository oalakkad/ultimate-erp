import { type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { type AppConfig } from './platform/config/config.js';
import { JobHandlers, WorkerModule } from './worker.module.js';

/** Builds and starts the worker. Shared by `worker.ts` and the integration tests. */
export async function createWorker(config: AppConfig): Promise<INestApplicationContext> {
  const worker = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
    bufferLogs: true,
  });
  worker.useLogger(worker.get(Logger));
  worker.enableShutdownHooks();
  await worker.get(JobHandlers).start();
  return worker;
}
