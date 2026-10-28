import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from './columns.js';
import { users } from './identity.js';
import { tenants } from './tenancy.js';

/**
 * One-time tickets that carry a signed-in person from the main address to one company's
 * address (owner decision 2026-10-28). Tenant-owned on purpose: row-level security makes a
 * ticket invisible on any other company's host. Only a SHA-256 of the ticket is stored.
 */
export const handoffTickets = pgTable(
  'handoff_tickets',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('handoff_tickets_tenant_id_id_key').on(t.tenantId, t.id)],
);
