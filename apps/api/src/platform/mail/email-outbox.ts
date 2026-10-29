import { Inject, Injectable } from '@nestjs/common';
import {
  type Database,
  emailDeliveries,
  JOB_QUEUES,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { eq } from 'drizzle-orm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Job } from 'pg-boss';
import { DB } from '../database/database.tokens.js';
import { JobQueue } from '../jobs/job-queue.js';
import { PayloadSealer } from '../jobs/payload-sealer.js';
import { type EmailMessage, Mailer } from './mailer.js';

/** What rests in the queue: the delivery ID and the whole message, encrypted. */
export interface EmailJob {
  deliveryId: string;
  message: string;
}

/**
 * The only way to send email (docs/modules/platform-jobs.md §3). `enqueue` records the email
 * and queues its delivery in the caller's transaction — no email for work that rolled back,
 * no lost email for work that committed. The worker delivers it with retries.
 */
@Injectable()
export class EmailOutbox {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly sealer: PayloadSealer,
  ) {}

  /** Returns the delivery ID (e.g. to show "email failed" next to an invitation). */
  enqueue(message: EmailMessage, tx?: Database | TenantTransaction): Promise<string> {
    const run = async (t: Database | TenantTransaction) => {
      const [row] = await t
        .insert(emailDeliveries)
        .values({ template: message.template, locale: message.locale, recipient: message.to })
        .returning({ id: emailDeliveries.id });
      if (!row) throw new Error('email delivery insert returned nothing');
      const job: EmailJob = { deliveryId: row.id, message: this.sealer.seal(message) };
      await this.jobs.enqueue(t, 'email.send', job);
      return row.id;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }
}

/**
 * Turns a mail failure into a stable code. Only the code is stored and logged: SMTP server
 * replies can quote addresses.
 */
export function mailErrorCode(err: unknown): string {
  const { code, responseCode } = (err ?? {}) as { code?: string; responseCode?: number };
  if (code === 'EAUTH') return 'SMTP_AUTH';
  if (code === 'EENVELOPE' || (responseCode && responseCode >= 500)) return 'SMTP_REJECTED';
  if (responseCode && responseCode >= 400) return 'SMTP_TEMPORARY';
  if (code && ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(code)) {
    return 'SMTP_UNAVAILABLE';
  }
  return 'SMTP_ERROR';
}

/** Error thrown to pg-boss after a failed attempt: it stores this message, so code only. */
export class EmailDeliveryError extends Error {
  override readonly name = 'EmailDeliveryError';
}

/** Worker side: delivers one queued email and records the outcome. */
@Injectable()
export class EmailDeliveryHandler {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly sealer: PayloadSealer,
    @InjectPinoLogger(EmailDeliveryHandler.name) private readonly logger: PinoLogger,
  ) {}

  async handle(job: Job<EmailJob>): Promise<void> {
    const { deliveryId } = job.data;
    const attempts = job.retryCount + 1;
    let code: string;
    try {
      let message: EmailMessage;
      try {
        message = this.sealer.open(job.data.message) as EmailMessage;
      } catch {
        throw Object.assign(new Error('payload'), { code: 'PAYLOAD_INVALID' });
      }
      await this.mailer.send(message);
      await this.db
        .update(emailDeliveries)
        .set({ status: 'sent', attempts, sentAt: new Date(), lastErrorCode: null })
        .where(eq(emailDeliveries.id, deliveryId));
      return;
    } catch (err) {
      code =
        (err as { code?: string }).code === 'PAYLOAD_INVALID'
          ? 'PAYLOAD_INVALID'
          : mailErrorCode(err);
    }
    const final = job.retryCount >= JOB_QUEUES['email.send'].retryLimit;
    await this.db
      .update(emailDeliveries)
      .set({ status: final ? 'failed' : 'queued', attempts, lastErrorCode: code })
      .where(eq(emailDeliveries.id, deliveryId));
    this.logger.warn({ jobId: job.id, deliveryId, attempts, code, final }, 'Email delivery failed');
    throw new EmailDeliveryError(code);
  }
}
