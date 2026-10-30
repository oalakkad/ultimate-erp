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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clients } from './clients.js';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { contracts } from './contracts.js';
import { projects } from './projects.js';
import { memberships, tenants } from './tenancy.js';
import { timeEntries } from './time.js';

// Invoicing & payments (docs/modules/billing.md §4).

export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void'] as const;
export const PAYMENT_METHODS = [
  'bank_transfer',
  'cash',
  'cheque',
  'card',
  'knet',
  'other',
] as const;

const tenantColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

export const invoices = pgTable(
  'invoices',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    /** Given when issued; drafts have none. */
    number: text('number'),
    clientId: uuid('client_id').notNull(),
    contractId: uuid('contract_id'),
    projectId: uuid('project_id'),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('draft'),
    currency: text('currency').notNull().default('KWD'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    subtotal: numeric('subtotal', { precision: 20, scale: 3 }).notNull().default('0'),
    discountTotal: numeric('discount_total', { precision: 20, scale: 3 }).notNull().default('0'),
    taxTotal: numeric('tax_total', { precision: 20, scale: 3 }).notNull().default('0'),
    total: numeric('total', { precision: 20, scale: 3 }).notNull().default('0'),
    notes: text('notes').notNull().default(''),
    voidReason: text('void_reason'),
    reminderSentOn: date('reminder_sent_on', { mode: 'string' }),
    createdByUserId: uuid('created_by_user_id').notNull(),
    issuedByUserId: uuid('issued_by_user_id'),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('invoices_tenant_id_key').on(t.tenantId, t.id),
    uniqueIndex('invoices_tenant_number_key')
      .on(t.tenantId, t.number)
      .where(sql`number is not null`),
    index('invoices_tenant_client_idx').on(t.tenantId, t.clientId),
    index('invoices_tenant_status_idx').on(t.tenantId, t.status, t.dueDate),
    foreignKey({
      name: 'invoices_client_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [clients.tenantId, clients.id],
    }),
    // Contract and project must belong to the invoice's client.
    foreignKey({
      name: 'invoices_contract_client_fk',
      columns: [t.tenantId, t.clientId, t.contractId],
      foreignColumns: [contracts.tenantId, contracts.clientId, contracts.id],
    }),
    foreignKey({
      name: 'invoices_project_client_fk',
      columns: [t.tenantId, t.clientId, t.projectId],
      foreignColumns: [projects.tenantId, projects.clientId, projects.id],
    }),
    foreignKey({
      name: 'invoices_created_by_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check(
      'invoices_status',
      sql`${t.status} in ('draft', 'issued', 'partially_paid', 'paid', 'void')`,
    ),
    check('invoices_currency', sql`${t.currency} = 'KWD'`),
    check(
      'invoices_issued_has_number',
      sql`${t.status} = 'draft' or (${t.number} is not null and ${t.issueDate} is not null and ${t.dueDate} is not null)`,
    ),
    check(
      'invoices_dates',
      sql`${t.dueDate} is null or ${t.issueDate} is null or ${t.dueDate} >= ${t.issueDate}`,
    ),
    check('invoices_void_reason', sql`${t.status} <> 'void' or ${t.voidReason} is not null`),
    check(
      'invoices_amounts',
      sql`${t.total} >= 0 and ${t.subtotal} >= 0 and ${t.discountTotal} >= 0 and ${t.taxTotal} >= 0`,
    ),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 2 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 20, scale: 3 }).notNull(),
    discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull().default('0'),
    taxCode: text('tax_code'),
    amount: numeric('amount', { precision: 20, scale: 3 }).notNull(),
    discount: numeric('discount', { precision: 20, scale: 3 }).notNull(),
    tax: numeric('tax', { precision: 20, scale: 3 }).notNull(),
  },
  (t) => [
    unique('invoice_lines_tenant_id_key').on(t.tenantId, t.id),
    index('invoice_lines_invoice_idx').on(t.tenantId, t.invoiceId),
    foreignKey({
      name: 'invoice_lines_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete('cascade'),
    check(
      'invoice_lines_values',
      sql`${t.quantity} > 0 and ${t.unitPrice} >= 0 and ${t.discountPercent} between 0 and 100`,
    ),
    check('invoice_lines_description', sql`length(trim(${t.description})) between 1 and 500`),
  ],
);

/** Each approved time entry is billed at most once. */
export const invoiceTimeEntries = pgTable(
  'invoice_time_entries',
  {
    tenantId: tenantColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    timeEntryId: uuid('time_entry_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'invoice_time_entries_pkey', columns: [t.tenantId, t.timeEntryId] }),
    index('invoice_time_entries_invoice_idx').on(t.tenantId, t.invoiceId),
    foreignKey({
      name: 'invoice_time_entries_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invoice_time_entries_entry_fk',
      columns: [t.tenantId, t.timeEntryId],
      foreignColumns: [timeEntries.tenantId, timeEntries.id],
    }),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 3 }).notNull(),
    currency: text('currency').notNull().default('KWD'),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    reference: text('reference').notNull().default(''),
    /** Recorded by staff, or confirmed by an integrated payment provider (none yet). */
    source: text('source', { enum: ['recorded', 'provider'] })
      .notNull()
      .default('recorded'),
    status: text('status', { enum: ['recorded', 'reversed'] })
      .notNull()
      .default('recorded'),
    reverseReason: text('reverse_reason'),
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payments_tenant_id_key').on(t.tenantId, t.id),
    index('payments_invoice_idx').on(t.tenantId, t.invoiceId),
    foreignKey({
      name: 'payments_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    check('payments_amount', sql`${t.amount} > 0`),
    check('payments_currency', sql`${t.currency} = 'KWD'`),
    check(
      'payments_reverse_reason',
      sql`${t.status} <> 'reversed' or ${t.reverseReason} is not null`,
    ),
  ],
);

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 3 }).notNull(),
    reason: text('reason').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    issuedByUserId: uuid('issued_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('credit_notes_tenant_id_key').on(t.tenantId, t.id),
    unique('credit_notes_tenant_number_key').on(t.tenantId, t.number),
    foreignKey({
      name: 'credit_notes_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    check('credit_notes_amount', sql`${t.amount} > 0`),
    check('credit_notes_reason', sql`length(trim(${t.reason})) between 1 and 1000`),
  ],
);
