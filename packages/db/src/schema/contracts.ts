import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { clients } from './clients.js';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { files } from './files.js';
import { memberships, tenants } from './tenancy.js';

// Contracts & engagement letters (docs/modules/contracts.md §3).

export const CONTRACT_KINDS = ['contract', 'engagement_letter'] as const;
export const CONTRACT_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'sent',
  'signed',
  'active',
  'expired',
  'terminated',
] as const;

export const contractTemplates = pgTable(
  'contract_templates',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind', { enum: CONTRACT_KINDS }).notNull(),
    name: text('name').notNull(),
    bodyEn: text('body_en').notNull(),
    bodyAr: text('body_ar').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('contract_templates_tenant_id_id_key').on(t.tenantId, t.id),
    check('contract_templates_kind_valid', sql`${t.kind} in ('contract', 'engagement_letter')`),
    check(
      'contract_templates_body_length',
      sql`length(${t.bodyEn}) <= 100000 and length(${t.bodyAr}) <= 100000`,
    ),
  ],
);

export const contracts = pgTable(
  'contracts',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind', { enum: CONTRACT_KINDS }).notNull(),
    number: text('number').notNull(),
    clientId: uuid('client_id').notNull(),
    templateId: uuid('template_id'),
    titleEn: text('title_en').notNull(),
    titleAr: text('title_ar').notNull(),
    status: text('status', { enum: CONTRACT_STATUSES }).notNull().default('draft'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    valueAmount: numeric('value_amount', { precision: 20, scale: 3 }),
    currency: text('currency').notNull().default('KWD'),
    paymentTerms: text('payment_terms'),
    renewalNoticeDays: integer('renewal_notice_days').notNull().default(30),
    currentVersion: integer('current_version').notNull().default(0),
    submittedByUserId: uuid('submitted_by_user_id'),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signedFileId: uuid('signed_file_id'),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }),
    terminationReason: text('termination_reason'),
    renewalNotifiedAt: timestamp('renewal_notified_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').notNull(),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('contracts_tenant_id_id_key').on(t.tenantId, t.id),
    unique('contracts_tenant_number_key').on(t.tenantId, t.number),
    // Lets projects require a contract of the same client (composite foreign key).
    unique('contracts_tenant_client_id_key').on(t.tenantId, t.clientId, t.id),
    index('contracts_tenant_client_idx').on(t.tenantId, t.clientId),
    index('contracts_tenant_status_end_idx').on(t.tenantId, t.status, t.endDate),
    foreignKey({
      name: 'contracts_client_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    foreignKey({
      name: 'contracts_template_fk',
      columns: [t.tenantId, t.templateId],
      foreignColumns: [contractTemplates.tenantId, contractTemplates.id],
    }),
    foreignKey({
      name: 'contracts_signed_file_fk',
      columns: [t.tenantId, t.signedFileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: 'contracts_created_by_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    foreignKey({
      name: 'contracts_submitted_by_fk',
      columns: [t.tenantId, t.submittedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    foreignKey({
      name: 'contracts_approved_by_fk',
      columns: [t.tenantId, t.approvedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('contracts_kind_valid', sql`${t.kind} in ('contract', 'engagement_letter')`),
    check(
      'contracts_status_valid',
      sql`${t.status} in ('draft', 'in_review', 'approved', 'sent', 'signed', 'active', 'expired', 'terminated')`,
    ),
    check(
      'contracts_dates_ordered',
      sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
    check('contracts_value_nonnegative', sql`${t.valueAmount} is null or ${t.valueAmount} >= 0`),
    check('contracts_currency_code', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('contracts_notice_days', sql`${t.renewalNoticeDays} between 0 and 365`),
    // Separation of duties: nobody approves what they submitted (also checked by the API).
    check(
      'contracts_approver_not_submitter',
      sql`${t.approvedByUserId} is null or ${t.submittedByUserId} is null or ${t.approvedByUserId} <> ${t.submittedByUserId}`,
    ),
    check(
      'contracts_signed_needs_file',
      sql`${t.signedAt} is null or ${t.signedFileId} is not null`,
    ),
  ],
);

/** Immutable text history: each change in draft adds a version. */
export const contractVersions = pgTable(
  'contract_versions',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    contractId: uuid('contract_id').notNull(),
    versionNo: integer('version_no').notNull(),
    bodyEn: text('body_en').notNull(),
    bodyAr: text('body_ar').notNull(),
    changeNote: text('change_note'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'contract_versions_pkey',
      columns: [t.tenantId, t.contractId, t.versionNo],
    }),
    foreignKey({
      name: 'contract_versions_contract_fk',
      columns: [t.tenantId, t.contractId],
      foreignColumns: [contracts.tenantId, contracts.id],
    }),
    foreignKey({
      name: 'contract_versions_author_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('contract_versions_positive', sql`${t.versionNo} > 0`),
    check(
      'contract_versions_body_length',
      sql`length(${t.bodyEn}) <= 100000 and length(${t.bodyAr}) <= 100000`,
    ),
  ],
);
