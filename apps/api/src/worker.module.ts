import { type DynamicModule, Injectable, Module } from '@nestjs/common';
import { JOB_QUEUES } from '@ultimate-erp/db';
import { ContractsDailyHandler } from './modules/contracts/contracts.service.js';
import { FileScanHandler, type FileScanJob } from './modules/files/files.service.js';
import { TasksDailyHandler } from './modules/tasks/tasks.service.js';
import { NotifierModule } from './platform/notifications/notifier.js';
import { AuditModule } from './platform/audit/audit.module.js';
import { type AppConfig } from './platform/config/config.js';
import { ConfigModule } from './platform/config/config.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { ObjectStorage } from './platform/files/object-storage.js';
import { VirusScanner } from './platform/files/virus-scanner.js';
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
    private readonly fileScan: FileScanHandler,
    private readonly contractsDaily: ContractsDailyHandler,
    private readonly tasksDaily: TasksDailyHandler,
  ) {}

  async start(): Promise<void> {
    await this.jobs.work<EmailJob>('email.send', (job) => this.email.handle(job));
    await this.jobs.work<FileScanJob>('file.scan', (job) =>
      this.fileScan.handle(job, job.retryCount >= JOB_QUEUES['file.scan'].retryLimit),
    );
    await this.jobs.work('contracts.daily', async (job) => {
      await this.contractsDaily.handle(job);
    });
    // Every day at 08:00 Kuwait time (renewal reminders, expiry).
    await this.jobs.schedule('contracts.daily', '0 8 * * *', 'Asia/Kuwait');
    await this.jobs.work('tasks.daily', async (job) => {
      await this.tasksDaily.handle(job);
    });
    // Every day at 08:00 Kuwait time (overdue alerts).
    await this.jobs.schedule('tasks.daily', '0 8 * * *', 'Asia/Kuwait');
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
        AuditModule,
        NotifierModule,
      ],
      providers: [
        JobHandlers,
        FileScanHandler,
        ContractsDailyHandler,
        TasksDailyHandler,
        ObjectStorage,
        VirusScanner,
      ],
    };
  }
}
