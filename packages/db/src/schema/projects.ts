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
import { contracts } from './contracts.js';
import { files } from './files.js';
import { memberships, tenants } from './tenancy.js';

// Projects / engagements & budgeting (docs/modules/projects.md §4).

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export const BILLING_METHODS = [
  'fixed_price',
  'time_and_materials',
  'retainer',
  'non_billable',
] as const;

export const projects = pgTable(
  'projects',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: text('number').notNull(),
    clientId: uuid('client_id').notNull(),
    contractId: uuid('contract_id'),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    description: text('description'),
    managerMembershipId: uuid('manager_membership_id').notNull(),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('planned'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    billingMethod: text('billing_method', { enum: BILLING_METHODS })
      .notNull()
      .default('time_and_materials'),
    budgetHours: numeric('budget_hours', { precision: 10, scale: 2 }).notNull(),
    budgetAmount: numeric('budget_amount', { precision: 20, scale: 3 }),
    currency: text('currency').notNull().default('KWD'),
    budgetRevision: integer('budget_revision').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').notNull(),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('projects_tenant_id_id_key').on(t.tenantId, t.id),
    unique('projects_tenant_number_key').on(t.tenantId, t.number),
    index('projects_tenant_client_idx').on(t.tenantId, t.clientId),
    foreignKey({
      name: 'projects_client_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    // The linked contract must belong to the same client.
    foreignKey({
      name: 'projects_contract_same_client_fk',
      columns: [t.tenantId, t.clientId, t.contractId],
      foreignColumns: [contracts.tenantId, contracts.clientId, contracts.id],
    }),
    foreignKey({
      name: 'projects_manager_fk',
      columns: [t.tenantId, t.managerMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'projects_created_by_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check(
      'projects_status_valid',
      sql`${t.status} in ('planned', 'active', 'on_hold', 'completed', 'cancelled')`,
    ),
    check(
      'projects_billing_valid',
      sql`${t.billingMethod} in ('fixed_price', 'time_and_materials', 'retainer', 'non_billable')`,
    ),
    check(
      'projects_dates_ordered',
      sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
    check(
      'projects_budget_nonnegative',
      sql`${t.budgetHours} >= 0 and (${t.budgetAmount} is null or ${t.budgetAmount} >= 0)`,
    ),
    check('projects_currency_code', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: uuid('project_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    addedByUserId: uuid('added_by_user_id').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'project_members_pkey',
      columns: [t.tenantId, t.projectId, t.membershipId],
    }),
    index('project_members_membership_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'project_members_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: 'project_members_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'project_members_added_by_fk',
      columns: [t.tenantId, t.addedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);

/** Every budget the project has had: append-only, each with a reason and an author. */
export const projectBudgetRevisions = pgTable(
  'project_budget_revisions',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: uuid('project_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    budgetHours: numeric('budget_hours', { precision: 10, scale: 2 }).notNull(),
    budgetAmount: numeric('budget_amount', { precision: 20, scale: 3 }),
    reason: text('reason').notNull(),
    changedByUserId: uuid('changed_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'project_budget_revisions_pkey',
      columns: [t.tenantId, t.projectId, t.revisionNo],
    }),
    foreignKey({
      name: 'project_budget_revisions_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: 'project_budget_revisions_author_fk',
      columns: [t.tenantId, t.changedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('project_budget_revisions_positive', sql`${t.revisionNo} > 0`),
    check('project_budget_revisions_reason', sql`length(trim(${t.reason})) between 1 and 1000`),
  ],
);

export const projectDocuments = pgTable(
  'project_documents',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: uuid('project_id').notNull(),
    fileId: uuid('file_id').notNull(),
    addedByUserId: uuid('added_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'project_documents_pkey', columns: [t.tenantId, t.projectId, t.fileId] }),
    unique('project_documents_tenant_file_key').on(t.tenantId, t.fileId),
    foreignKey({
      name: 'project_documents_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: 'project_documents_file_fk',
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: 'project_documents_added_by_fk',
      columns: [t.tenantId, t.addedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);
