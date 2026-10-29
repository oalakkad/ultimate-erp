import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { files } from './files.js';
import { memberships, tenants } from './tenancy.js';

// Clients / CRM (docs/modules/clients.md §3). Every reference is a composite foreign key with
// tenant_id, so no record can ever point at another company's client.

/** Gap-free per-company document numbers (clients now; contracts and invoices later). */
export const numberSequences = pgTable(
  'number_sequences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'number_sequences_pkey', columns: [t.tenantId, t.name] }),
    check('number_sequences_positive', sql`${t.nextValue} > 0`),
  ],
);

export const CLIENT_TYPES = ['company', 'individual', 'government'] as const;
export const CLIENT_STATUSES = ['prospect', 'active', 'inactive'] as const;

export const clients = pgTable(
  'clients',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: text('number').notNull(),
    type: text('type', { enum: CLIENT_TYPES }).notNull().default('company'),
    legalNameEn: text('legal_name_en').notNull(),
    legalNameAr: text('legal_name_ar').notNull(),
    /** Normalised name for duplicate warnings (see clients.md §9). */
    nameKey: text('name_key').notNull(),
    commercialRegistration: text('commercial_registration'),
    industry: text('industry'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    addressLine: text('address_line'),
    city: text('city'),
    country: text('country').notNull().default('KW'),
    status: text('status', { enum: CLIENT_STATUSES }).notNull().default('prospect'),
    accountManagerMembershipId: uuid('account_manager_membership_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').notNull(),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('clients_tenant_id_id_key').on(t.tenantId, t.id),
    unique('clients_tenant_number_key').on(t.tenantId, t.number),
    uniqueIndex('clients_tenant_cr_key')
      .on(t.tenantId, t.commercialRegistration)
      .where(sql`${t.commercialRegistration} is not null`),
    index('clients_tenant_name_key_idx').on(t.tenantId, t.nameKey),
    index('clients_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    foreignKey({
      name: 'clients_account_manager_fk',
      columns: [t.tenantId, t.accountManagerMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'clients_created_by_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('clients_type_valid', sql`${t.type} in ('company', 'individual', 'government')`),
    check('clients_status_valid', sql`${t.status} in ('prospect', 'active', 'inactive')`),
    check('clients_country_code', sql`${t.country} ~ '^[A-Z]{2}$'`),
    check(
      'clients_names_present',
      sql`length(trim(${t.legalNameEn})) > 0 and length(trim(${t.legalNameAr})) > 0`,
    ),
  ],
);

export const clientContacts = pgTable(
  'client_contacts',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    clientId: uuid('client_id').notNull(),
    name: text('name').notNull(),
    position: text('position'),
    email: text('email'),
    phone: text('phone'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isAuthorizedRepresentative: boolean('is_authorized_representative').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('client_contacts_tenant_id_id_key').on(t.tenantId, t.id),
    unique('client_contacts_tenant_client_id_key').on(t.tenantId, t.clientId, t.id),
    // At most one active primary contact per client.
    uniqueIndex('client_contacts_one_primary')
      .on(t.tenantId, t.clientId)
      .where(sql`${t.isPrimary} and ${t.archivedAt} is null`),
    foreignKey({
      name: 'client_contacts_client_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
  ],
);

export const INTERACTION_KINDS = ['note', 'call', 'meeting', 'email'] as const;

/** Communication history and notes. Append-only (a correction is a new entry). */
export const clientInteractions = pgTable(
  'client_interactions',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    clientId: uuid('client_id').notNull(),
    contactId: uuid('contact_id'),
    kind: text('kind', { enum: INTERACTION_KINDS }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('client_interactions_tenant_id_id_key').on(t.tenantId, t.id),
    index('client_interactions_client_idx').on(t.tenantId, t.clientId, t.occurredAt.desc()),
    foreignKey({
      name: 'client_interactions_client_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    // The contact must belong to the same client (and company).
    foreignKey({
      name: 'client_interactions_contact_fk',
      columns: [t.tenantId, t.clientId, t.contactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.clientId, clientContacts.id],
    }),
    foreignKey({
      name: 'client_interactions_author_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('client_interactions_kind_valid', sql`${t.kind} in ('note', 'call', 'meeting', 'email')`),
    check('client_interactions_summary_length', sql`length(${t.summary}) between 1 and 4000`),
  ],
);

/** Files attached to a client (the file itself is virus-scanned by the files service). */
export const clientDocuments = pgTable(
  'client_documents',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    clientId: uuid('client_id').notNull(),
    fileId: uuid('file_id').notNull(),
    addedByUserId: uuid('added_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'client_documents_pkey', columns: [t.tenantId, t.clientId, t.fileId] }),
    unique('client_documents_tenant_id_file_key').on(t.tenantId, t.fileId),
    foreignKey({
      name: 'client_documents_client_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    foreignKey({
      name: 'client_documents_file_fk',
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: 'client_documents_added_by_fk',
      columns: [t.tenantId, t.addedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);
