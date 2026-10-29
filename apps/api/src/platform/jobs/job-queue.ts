import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  type Database,
  JOB_QUEUES,
  JOB_SCHEMA,
  type JobName,
  type TenantTransaction,
  transactionExecutor,
} from '@ultimate-erp/db';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Job, PgBoss } from 'pg-boss';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { reportError } from '../monitoring/monitoring.js';

/** The API only adds jobs; the worker also takes them and runs queue maintenance. */
export type JobRole = 'producer' | 'worker';
export const JOB_ROLE = Symbol('JOB_ROLE');

/**
 * The background job queue (pg-boss in Postgres, ADR-0002). Connects lazily, so the API still
 * starts — and reports the database as down on /health — when Postgres is unavailable.
 * Connected as erp_app: it can add and take jobs but never change the queue's tables.
 */
@Injectable()
export class JobQueue implements OnApplicationShutdown {
  private readonly boss: PgBoss;
  private starting: Promise<void> | undefined;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(JOB_ROLE) private readonly role: JobRole,
    @InjectPinoLogger(JobQueue.name) private readonly logger: PinoLogger,
  ) {
    this.boss = new PgBoss({
      connectionString: config.DATABASE_URL,
      schema: JOB_SCHEMA,
      application_name: `ultimate-erp-${role}`,
      max: role === 'worker' ? 4 : 2,
      migrate: false,
      createSchema: false,
      supervise: role === 'worker',
      schedule: false,
    });
    this.boss.on('error', (err) => {
      this.logger.error({ err }, 'Job queue error');
    });
  }

  /**
   * Adds a job inside `tx`: it exists if and only if `tx` commits (transactional outbox).
   * `data` must hold IDs and sealed secrets only (PayloadSealer) — it rests in the database.
   */
  async enqueue(tx: Database | TenantTransaction, name: JobName, data: object): Promise<string> {
    await this.start();
    const id = await this.boss.send(name, data, { db: transactionExecutor(tx) });
    if (!id) throw new Error(`Job ${name} was not queued`);
    return id;
  }

  /** Worker only: runs `handler` for each job of `name`; a thrown error schedules a retry. */
  async work<T extends object>(name: JobName, handler: (job: Job<T>) => Promise<void>) {
    if (this.role !== 'worker') throw new Error('Only the worker process takes jobs');
    await this.start();
    const retryLimit = JOB_QUEUES[name].retryLimit;
    await this.boss.work<T>(name, { batchSize: 1 }, async ([job]) => {
      if (!job) return;
      try {
        await handler(job);
      } catch (err) {
        // Only the last attempt is worth an alert; earlier ones are retried automatically.
        if (job.retryCount >= retryLimit) reportError(err, { jobId: job.id, jobName: name });
        throw err;
      }
    });
  }

  private start(): Promise<void> {
    this.starting ??= this.boss.start().then(
      () => undefined,
      (err: unknown) => {
        this.starting = undefined; // try again on the next call
        throw err;
      },
    );
    return this.starting;
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.starting) return;
    // Graceful: a job in progress finishes (or is retried later) instead of being cut off.
    await this.starting.catch(() => undefined);
    await this.boss.stop({ graceful: true, close: true, timeout: 10_000 });
  }
}
