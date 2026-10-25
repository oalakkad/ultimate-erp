import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './columns.js';

/**
 * Global user accounts (not tenant-owned): one person can belong to several companies
 * through memberships. Credentials, sessions and MFA arrive with Better Auth in Milestone 1.3,
 * which maps onto this table.
 */
export const users = pgTable(
  'users',
  {
    id: idColumn(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);
