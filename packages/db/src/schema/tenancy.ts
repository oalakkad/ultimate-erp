import { sql } from 'drizzle-orm';
import {
  char,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { users } from './identity.js';

export const TENANT_STATUSES = ['active', 'suspended'] as const;
export const LOCALES = ['en', 'ar'] as const;
export const DOMAIN_KINDS = ['subdomain', 'custom'] as const;
export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'removed'] as const;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** A company using the platform. The root of tenant isolation: its `id` is the tenant ID. */
export const tenants = pgTable(
  'tenants',
  {
    id: idColumn(),
    slug: text('slug').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    status: text('status', { enum: TENANT_STATUSES }).notNull().default('active'),
    defaultLocale: text('default_locale', { enum: LOCALES }).notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Kuwait'),
    currency: char('currency', { length: 3 }).notNull().default('KWD'),
    ...timestamps(),
    version: versionColumn(),
  },
  (t) => [
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
    check('tenants_status_valid', sql`${t.status} in (${inList(TENANT_STATUSES)})`),
    check('tenants_locale_valid', sql`${t.defaultLocale} in (${inList(LOCALES)})`),
    check('tenants_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/** Host names that route to a tenant, e.g. `acme.localhost` or a verified custom domain. */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    hostname: text('hostname').notNull().unique(),
    kind: text('kind', { enum: DOMAIN_KINDS }).notNull(),
    /** Null until ownership is verified; unverified domains never route traffic. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('tenant_domains_tenant_id_id_key').on(t.tenantId, t.id),
    index('tenant_domains_tenant_id_idx').on(t.tenantId),
    check('tenant_domains_hostname_lowercase', sql`${t.hostname} = lower(${t.hostname})`),
    check('tenant_domains_kind_valid', sql`${t.kind} in (${inList(DOMAIN_KINDS)})`),
  ],
);

/** A user's membership in one tenant. Roles and the employee record attach to it later. */
export const memberships = pgTable(
  'memberships',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: MEMBERSHIP_STATUSES }).notNull().default('invited'),
    /** Who invited this member — must be a membership of the same tenant (composite FK). */
    invitedByMembershipId: uuid('invited_by_membership_id'),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    ...timestamps(),
    version: versionColumn(),
  },
  (t) => [
    unique('memberships_tenant_id_id_key').on(t.tenantId, t.id),
    unique('memberships_tenant_id_user_id_key').on(t.tenantId, t.userId),
    foreignKey({
      name: 'memberships_invited_by_fk',
      columns: [t.tenantId, t.invitedByMembershipId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check('memberships_status_valid', sql`${t.status} in (${inList(MEMBERSHIP_STATUSES)})`),
  ],
);
