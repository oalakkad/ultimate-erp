import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn } from './columns.js';
import { memberships, tenants } from './tenancy.js';

/**
 * In-app notifications (brief Module L; docs/modules/platform-jobs.md §4). One row per
 * recipient. The composite foreign key makes it physically impossible to address someone who
 * is not a member of that company. `params` holds IDs and display names only; `link` is a
 * relative path — opening it never grants access by itself.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(),
    params: jsonb('params').$type<Record<string, string>>().notNull().default({}),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notifications_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'notifications_recipient_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    index('notifications_recipient_idx').on(t.tenantId, t.userId, t.createdAt.desc(), t.id.desc()),
    check('notifications_type_format', sql`${t.type} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
    // "/" or "/x…", never "//host" or "/\host" (which browsers treat as another site).
    check('notifications_link_relative', sql`${t.link} is null or ${t.link} ~ '^/([^/\\\\].*)?$'`),
  ],
);
