import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn } from './columns.js';
import { emailDeliveries } from './mail.js';
import { memberships, tenants } from './tenancy.js';

// Notification preferences and company announcements (docs/modules/notifications.md §3).

const tenantColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

/** Per person and type; no row = defaults (in the app, no email). */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    type: text('type').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'notification_preferences_pkey',
      columns: [t.tenantId, t.membershipId, t.type],
    }),
    foreignKey({
      name: 'notification_preferences_member_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
  ],
);

export const announcements = pgTable(
  'announcements',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    titleEn: text('title_en').notNull(),
    titleAr: text('title_ar').notNull(),
    bodyEn: text('body_en').notNull(),
    bodyAr: text('body_ar').notNull(),
    /** Role keys; empty = everyone. */
    roles: jsonb('roles').$type<string[]>().notNull().default([]),
    email: boolean('email').notNull().default(false),
    recipients: integer('recipients').notNull(),
    publishedByUserId: uuid('published_by_user_id').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('announcements_tenant_id_key').on(t.tenantId, t.id),
    index('announcements_tenant_published_idx').on(t.tenantId, t.publishedAt),
    foreignKey({
      name: 'announcements_published_by_fk',
      columns: [t.tenantId, t.publishedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('announcements_recipients', sql`${t.recipients} >= 0`),
  ],
);

/** Email copies of an announcement, for delivery status. */
export const announcementEmails = pgTable(
  'announcement_emails',
  {
    tenantId: tenantColumn(),
    announcementId: uuid('announcement_id').notNull(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => emailDeliveries.id),
  },
  (t) => [
    primaryKey({
      name: 'announcement_emails_pkey',
      columns: [t.tenantId, t.announcementId, t.deliveryId],
    }),
    foreignKey({
      name: 'announcement_emails_announcement_fk',
      columns: [t.tenantId, t.announcementId],
      foreignColumns: [announcements.tenantId, announcements.id],
    }),
  ],
);
