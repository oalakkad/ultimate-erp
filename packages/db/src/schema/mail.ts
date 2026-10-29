import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './columns.js';

export const EMAIL_DELIVERY_STATUSES = ['queued', 'sent', 'failed'] as const;

/**
 * Delivery status of every transactional email (docs/modules/platform-jobs.md §4). Global on
 * purpose — account emails (sign-up, reset) belong to no company — and owned by platform mail
 * code only. Holds no body and no links: one-time tokens never rest here.
 */
export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: idColumn(),
    template: text('template').notNull(),
    locale: text('locale').notNull(),
    recipient: text('recipient').notNull(),
    status: text('status', { enum: EMAIL_DELIVERY_STATUSES }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** A stable code such as `SMTP_UNAVAILABLE`, never the mail server's own text. */
    lastErrorCode: text('last_error_code'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('email_deliveries_status_valid', sql`${t.status} in ('queued', 'sent', 'failed')`),
    check('email_deliveries_attempts_nonnegative', sql`${t.attempts} >= 0`),
  ],
);
