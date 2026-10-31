import { sql } from 'drizzle-orm';
import {
  boolean,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { invoices } from './billing.js';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { files } from './files.js';
import { projects } from './projects.js';
import { memberships, tenants } from './tenancy.js';

// Expenses (docs/modules/expenses.md §4).

export const EXPENSE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
] as const;
export const REIMBURSEMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'other'] as const;

const tenantColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

export const expenseClaims = pgTable(
  'expense_claims',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    /** Given on first submission; drafts have none. */
    number: text('number'),
    membershipId: uuid('membership_id').notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: EXPENSE_STATUSES }).notNull().default('draft'),
    currency: text('currency').notNull().default('KWD'),
    total: numeric('total', { precision: 20, scale: 3 }).notNull().default('0'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedByMembershipId: uuid('decided_by_membership_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    reimbursedByMembershipId: uuid('reimbursed_by_membership_id'),
    reimbursedOn: date('reimbursed_on', { mode: 'string' }),
    reimbursementMethod: text('reimbursement_method', { enum: REIMBURSEMENT_METHODS }),
    reimbursementReference: text('reimbursement_reference').notNull().default(''),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('expense_claims_tenant_id_key').on(t.tenantId, t.id),
    uniqueIndex('expense_claims_tenant_number_key')
      .on(t.tenantId, t.number)
      .where(sql`number is not null`),
    index('expense_claims_tenant_member_idx').on(t.tenantId, t.membershipId),
    index('expense_claims_tenant_status_idx').on(t.tenantId, t.status),
    foreignKey({
      name: 'expense_claims_member_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'expense_claims_decider_fk',
      columns: [t.tenantId, t.decidedByMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'expense_claims_reimburser_fk',
      columns: [t.tenantId, t.reimbursedByMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    check(
      'expense_claims_status',
      sql`${t.status} in ('draft', 'submitted', 'approved', 'rejected', 'reimbursed')`,
    ),
    check('expense_claims_currency', sql`${t.currency} = 'KWD'`),
    check('expense_claims_total', sql`${t.total} >= 0`),
    check('expense_claims_title', sql`length(trim(${t.title})) between 1 and 200`),
    // Separation of duties: nobody decides or reimburses their own claim.
    check(
      'expense_claims_not_own_decision',
      sql`${t.decidedByMembershipId} is null or ${t.decidedByMembershipId} <> ${t.membershipId}`,
    ),
    check(
      'expense_claims_not_own_reimbursement',
      sql`${t.reimbursedByMembershipId} is null or ${t.reimbursedByMembershipId} <> ${t.membershipId}`,
    ),
    check(
      'expense_claims_submitted_has_number',
      sql`${t.status} = 'draft' or ${t.number} is not null`,
    ),
    check(
      'expense_claims_rejected_note',
      sql`${t.status} <> 'rejected' or ${t.decisionNote} is not null`,
    ),
    check(
      'expense_claims_reimbursed_fields',
      sql`${t.status} <> 'reimbursed' or (${t.reimbursedOn} is not null and ${t.reimbursementMethod} is not null and ${t.reimbursedByMembershipId} is not null)`,
    ),
  ],
);

export const expenseLines = pgTable(
  'expense_lines',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    claimId: uuid('claim_id').notNull(),
    position: integer('position').notNull(),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    amount: numeric('amount', { precision: 20, scale: 3 }).notNull(),
    projectId: uuid('project_id'),
    billable: boolean('billable').notNull().default(false),
    receiptFileId: uuid('receipt_file_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('expense_lines_tenant_id_key').on(t.tenantId, t.id),
    index('expense_lines_claim_idx').on(t.tenantId, t.claimId),
    index('expense_lines_project_idx').on(t.tenantId, t.projectId),
    foreignKey({
      name: 'expense_lines_claim_fk',
      columns: [t.tenantId, t.claimId],
      foreignColumns: [expenseClaims.tenantId, expenseClaims.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'expense_lines_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: 'expense_lines_receipt_fk',
      columns: [t.tenantId, t.receiptFileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    check('expense_lines_amount', sql`${t.amount} > 0 and ${t.amount} <= 100000`),
    check('expense_lines_description', sql`length(trim(${t.description})) between 1 and 500`),
    check('expense_lines_billable_project', sql`not ${t.billable} or ${t.projectId} is not null`),
  ],
);

/** Each approved billable expense line is re-billed at most once. */
export const invoiceExpenseLines = pgTable(
  'invoice_expense_lines',
  {
    tenantId: tenantColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    expenseLineId: uuid('expense_line_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'invoice_expense_lines_pkey', columns: [t.tenantId, t.expenseLineId] }),
    index('invoice_expense_lines_invoice_idx').on(t.tenantId, t.invoiceId),
    foreignKey({
      name: 'invoice_expense_lines_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invoice_expense_lines_line_fk',
      columns: [t.tenantId, t.expenseLineId],
      foreignColumns: [expenseLines.tenantId, expenseLines.id],
    }),
  ],
);
