import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './columns.js';

// Global identity tables (docs/modules/identity.md §3): not tenant-owned, because sign-in must
// find an account before any company is known. Only the identity module may use them.
// Column property names match Better Auth's field names so its Drizzle adapter can map them.

export const USER_LOCALES = ['en', 'ar'] as const;

/** One person's account. A person can belong to several companies through memberships. */
export const users = pgTable(
  'users',
  {
    id: idColumn(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull(),
    image: text('image'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    locale: text('locale', { enum: USER_LOCALES }).notNull().default('en'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`),
    check('users_locale_valid', sql`${t.locale} in ('en', 'ar')`),
  ],
);

/** Credentials (scrypt password hash) and, later, SSO provider links. */
export const accounts = pgTable(
  'accounts',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps(),
  },
  (t) => [
    unique('accounts_provider_account_key').on(t.providerId, t.accountId),
    index('accounts_user_id_idx').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /**
     * When the person actually authenticated (password + code). A company hand-off copies it to
     * the new session, so the 12-hour absolute limit can never be extended by hopping hosts.
     */
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** Single-use tokens: email verification, password reset, two-factor sign-in steps. */
export const verifications = pgTable(
  'verifications',
  {
    id: idColumn(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/** TOTP secret and backup codes, encrypted by Better Auth with AUTH_SECRET. */
export const twoFactors = pgTable(
  'two_factors',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('two_factors_secret_idx').on(t.secret)],
);

/** Accepted TOTP codes (hashed), so a code cannot be replayed within its validity window. */
export const usedTotpCodes = pgTable(
  'used_totp_codes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
);

/** Browsers (hashed user agent) a user has signed in from, for new-device notices. */
export const userKnownDevices = pgTable(
  'user_known_devices',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceHash: text('device_hash').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceHash] })],
);

/** Fixed-window counters for rate limits. Keys are SHA-256 hashes (no emails or IPs stored). */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
});
