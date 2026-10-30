import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { employees } from './people.js';
import { memberships, tenants } from './tenancy.js';

// Payroll (docs/modules/payroll.md §4). Sensitive: only payroll permissions read these tables.

export const PAYROLL_RUN_STATUSES = [
  'draft',
  'calculated',
  'submitted',
  'approved',
  'paid',
  'cancelled',
] as const;
export const PAYROLL_INPUT_KINDS = [
  'overtime_hours',
  'bonus',
  'advance',
  'addition',
  'deduction',
] as const;

const tenantColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

/** Versioned rule sets; a run keeps the version it was calculated with. */
export const payrollRuleSets = pgTable(
  'payroll_rule_sets',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    version: integer('version').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    rules: jsonb('rules').notNull(),
    /** True until an authorised person confirms a Kuwaiti lawyer/accountant verified the rules. */
    toVerify: boolean('to_verify').notNull().default(true),
    note: text('note').notNull().default(''),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payroll_rule_sets_tenant_id_key').on(t.tenantId, t.id),
    unique('payroll_rule_sets_tenant_version_key').on(t.tenantId, t.version),
  ],
);

export const salaryRecords = pgTable(
  'salary_records',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    basic: numeric('basic', { precision: 20, scale: 3 }).notNull(),
    currency: text('currency').notNull().default('KWD'),
    /** [{ code, label, amount }] — fixed monthly allowances. */
    allowances: jsonb('allowances')
      .$type<{ code: string; label: string; amount: string }[]>()
      .notNull()
      .default([]),
    socialInsurance: boolean('social_insurance').notNull().default(false),
    note: text('note').notNull().default(''),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('salary_records_tenant_id_key').on(t.tenantId, t.id),
    unique('salary_records_member_effective_key').on(t.tenantId, t.membershipId, t.effectiveFrom),
    foreignKey({
      name: 'salary_records_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    check('salary_records_basic', sql`${t.basic} >= 0`),
    check('salary_records_currency', sql`${t.currency} = 'KWD'`),
  ],
);

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    /** "YYYY-MM". One run per company and month. */
    period: text('period').notNull(),
    status: text('status', { enum: PAYROLL_RUN_STATUSES }).notNull().default('draft'),
    ruleSetId: uuid('rule_set_id'),
    preparedByUserId: uuid('prepared_by_user_id').notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidByUserId: uuid('paid_by_user_id'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('payroll_runs_tenant_id_key').on(t.tenantId, t.id),
    // One live run per month; a cancelled run frees the month.
    uniqueIndex('payroll_runs_tenant_period_live_key')
      .on(t.tenantId, t.period)
      .where(sql`status <> 'cancelled'`),
    foreignKey({
      name: 'payroll_runs_rule_set_fk',
      columns: [t.tenantId, t.ruleSetId],
      foreignColumns: [payrollRuleSets.tenantId, payrollRuleSets.id],
    }),
    foreignKey({
      name: 'payroll_runs_prepared_by_fk',
      columns: [t.tenantId, t.preparedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('payroll_runs_period', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'payroll_runs_status',
      sql`${t.status} in ('draft', 'calculated', 'submitted', 'approved', 'paid', 'cancelled')`,
    ),
    // Separation of duties, also in the database.
    check(
      'payroll_runs_approver_not_preparer',
      sql`${t.approvedByUserId} is null or ${t.approvedByUserId} <> ${t.preparedByUserId}`,
    ),
    check(
      'payroll_runs_payer_not_preparer',
      sql`${t.paidByUserId} is null or ${t.paidByUserId} <> ${t.preparedByUserId}`,
    ),
    check(
      'payroll_runs_paid_needs_approval',
      sql`${t.status} <> 'paid' or (${t.approvedByUserId} is not null and ${t.paidByUserId} is not null)`,
    ),
  ],
);

export const payrollInputs = pgTable(
  'payroll_inputs',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    runId: uuid('run_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    kind: text('kind', { enum: PAYROLL_INPUT_KINDS }).notNull(),
    /** Hours for overtime, KWD for the others. */
    value: numeric('value', { precision: 20, scale: 3 }).notNull(),
    note: text('note').notNull().default(''),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payroll_inputs_tenant_id_key').on(t.tenantId, t.id),
    index('payroll_inputs_run_idx').on(t.tenantId, t.runId),
    foreignKey({
      name: 'payroll_inputs_run_fk',
      columns: [t.tenantId, t.runId],
      foreignColumns: [payrollRuns.tenantId, payrollRuns.id],
    }),
    foreignKey({
      name: 'payroll_inputs_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    check(
      'payroll_inputs_kind',
      sql`${t.kind} in ('overtime_hours', 'bonus', 'advance', 'addition', 'deduction')`,
    ),
    check('payroll_inputs_value', sql`${t.value} > 0`),
  ],
);

export const payslips = pgTable(
  'payslips',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    runId: uuid('run_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    salaryRecordId: uuid('salary_record_id').notNull(),
    gross: numeric('gross', { precision: 20, scale: 3 }).notNull(),
    deductions: numeric('deductions', { precision: 20, scale: 3 }).notNull(),
    net: numeric('net', { precision: 20, scale: 3 }).notNull(),
    currency: text('currency').notNull().default('KWD'),
    /** The full trace: [{ code, label, basis, amount }] plus the inputs used. */
    lines: jsonb('lines').notNull(),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payslips_tenant_id_key').on(t.tenantId, t.id),
    unique('payslips_run_member_key').on(t.tenantId, t.runId, t.membershipId),
    foreignKey({
      name: 'payslips_run_fk',
      columns: [t.tenantId, t.runId],
      foreignColumns: [payrollRuns.tenantId, payrollRuns.id],
    }),
    foreignKey({
      name: 'payslips_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    foreignKey({
      name: 'payslips_salary_fk',
      columns: [t.tenantId, t.salaryRecordId],
      foreignColumns: [salaryRecords.tenantId, salaryRecords.id],
    }),
    check('payslips_net', sql`${t.net} >= 0`),
  ],
);
