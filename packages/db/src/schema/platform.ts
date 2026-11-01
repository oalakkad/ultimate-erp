import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { idColumn } from './columns.js';
import { tenants } from './tenancy.js';

// Platform console (Phase 17, docs/modules/platform.md). Global tables: they belong to the
// installation, not to a company. The API reads them without a tenant context; founders are
// granted only by the command-line tool (never through the API).

export const PLATFORM_ROLES = ['founder'] as const;

/** Who may open the platform console. One row per person; granted by `pnpm platform:founder`. */
export const platformOperators = pgTable(
  'platform_operators',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    role: text('role', { enum: PLATFORM_ROLES }).notNull().default('founder'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Where the grant came from (e.g. "cli"), for the record. */
    grantedBy: text('granted_by').notNull(),
  },
  (t) => [check('platform_operators_role_valid', sql`${t.role} in ('founder')`)],
);

/** Append-only record of what founders did on the platform (suspensions, reactivations). */
export const platformAuditEvents = pgTable(
  'platform_audit_events',
  {
    id: idColumn(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    targetTenantId: uuid('target_tenant_id').references(() => tenants.id),
    requestId: text('request_id'),
    ipAddress: inet('ip_address'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('platform_audit_events_time_idx').on(t.occurredAt.desc(), t.id.desc()),
    check('platform_audit_events_action_format', sql`${t.action} ~ '^platform(\\.[a-z_]+)+$'`),
  ],
);
