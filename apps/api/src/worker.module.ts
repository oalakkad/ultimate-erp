import { type DynamicModule, Injectable, Module } from '@nestjs/common';
import { type AppConfig } from './platform/config/config.js';
import { ConfigModule } from './platform/config/config.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { JobQueue } from './platform/jobs/job-queue.js';
import { JobsModule } from './platform/jobs/jobs.module.js';
import { LoggingModule } from './platform/logging/logging.module.js';
import { type EmailJob, EmailDeliveryHandler } from './platform/mail/email-outbox.js';
import { MailModule } from './platform/mail/mail.module.js';

/** Connects every queue to its handler. New job types are registered here. */
@Injectable()
export class JobHandlers {
  constructor(
    private readonly jobs: JobQueue,
    private readonly email: EmailDeliveryHandler,
  ) {}

  async start(): Promise<void> {
    await this.jobs.work<EmailJob>('email.send', (job) => this.email.handle(job));
  }
}

/** The background worker: same codebase as the API, no HTTP (architecture §2). */
@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggingModule.forRoot(config),
        DatabaseModule.forRoot(config),
        JobsModule.forRoot('worker'),
        MailModule,
      ],
      providers: [JobHandlers],
    };
  }
}
