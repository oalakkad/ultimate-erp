import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './columns.js';
import { emailDeliveries } from './mail.js';
import { memberships, tenants } from './tenancy.js';

// Access module tables (docs/modules/access.md §4). All tenant-owned: RLS forced, composite
// foreign keys keep every link inside one tenant.

/** Role names are checked by the application against packages/contracts ROLES. */
const ROLE_FORMAT = sql.raw(`'^[a-z_]{2,40}$'`);

/** Which fixed roles a membership holds (several allowed). */
export const membershipRoles = pgTable(
  'membership_roles',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    membershipId: uuid('membership_id').notNull(),
    role: text('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.membershipId, t.role] }),
    foreignKey({
      name: 'membership_roles_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete('cascade'),
    check('membership_roles_role_format', sql`${t.role} ~ ${ROLE_FORMAT}`),
  ],
);

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'] as const;

/** An invitation to join a tenant with a role. Only a hash of the emailed token is stored. */
export const invitations = pgTable(
  'invitations',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    invitedByMembershipId: uuid('invited_by_membership_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status', { enum: INVITATION_STATUSES }).notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedMembershipId: uuid('accepted_membership_id'),
    /** The invitation email's delivery status (Members screen shows a failed send). */
    emailDeliveryId: uuid('email_delivery_id').references(() => emailDeliveries.id),
    ...timestamps(),
  },
  (t) => [
    unique('invitations_tenant_id_id_key').on(t.tenantId, t.id),
    index('invitations_tenant_email_idx').on(t.tenantId, t.email),
    foreignKey({
      name: 'invitations_invited_by_fk',
      columns: [t.tenantId, t.invitedByMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'invitations_accepted_membership_fk',
      columns: [t.tenantId, t.acceptedMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    check('invitations_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('invitations_role_format', sql`${t.role} ~ ${ROLE_FORMAT}`),
    check('invitations_status_valid', sql`${t.status} in ('pending', 'accepted', 'revoked')`),
  ],
);

/** Append-only record of who did what (UPDATE/DELETE rejected by a trigger for every role). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorMembershipId: uuid('actor_membership_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    requestId: text('request_id'),
    ipAddress: inet('ip_address'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    unique('audit_events_tenant_id_id_key').on(t.tenantId, t.id),
    index('audit_events_tenant_time_idx').on(t.tenantId, t.occurredAt.desc(), t.id.desc()),
    check('audit_events_action_format', sql`${t.action} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
  ],
);
