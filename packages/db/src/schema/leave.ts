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
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { files } from './files.js';
import { employees } from './people.js';
import { memberships, tenants } from './tenancy.js';

// Leave management (docs/modules/leave.md §3).

export const LEAVE_ACCRUALS = ['none', 'monthly', 'yearly'] as const;
export const LEAVE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;
export const HALF_DAYS = ['none', 'first', 'second'] as const;
export const LEDGER_KINDS = ['taken', 'restored', 'adjustment'] as const;

const tenantColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

/** A company leave policy. Pre-filled values are flagged `toVerify` until a professional confirms them. */
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    paid: boolean('paid').notNull().default(true),
    deductsBalance: boolean('deducts_balance').notNull().default(true),
    annualDays: numeric('annual_days', { precision: 6, scale: 2 }).notNull().default('0'),
    accrual: text('accrual', { enum: LEAVE_ACCRUALS }).notNull().default('yearly'),
    allowHalfDay: boolean('allow_half_day').notNull().default(true),
    requiresDocument: boolean('requires_document').notNull().default(false),
    allowNegative: boolean('allow_negative').notNull().default(false),
    toVerify: boolean('to_verify').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('leave_types_tenant_id_key').on(t.tenantId, t.id),
    unique('leave_types_tenant_code_key').on(t.tenantId, t.code),
    check('leave_types_accrual_valid', sql`${t.accrual} in ('none', 'monthly', 'yearly')`),
    check('leave_types_days', sql`${t.annualDays} >= 0 and ${t.annualDays} <= 366`),
    check('leave_types_code', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,39}$'`),
  ],
);

export const publicHolidays = pgTable(
  'public_holidays',
  {
    tenantId: tenantColumn(),
    date: date('date', { mode: 'string' }).notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
  },
  (t) => [primaryKey({ name: 'public_holidays_pkey', columns: [t.tenantId, t.date] })],
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    halfDay: text('half_day', { enum: HALF_DAYS }).notNull().default('none'),
    days: numeric('days', { precision: 6, scale: 2 }).notNull(),
    reason: text('reason').notNull().default(''),
    fileId: uuid('file_id'),
    status: text('status', { enum: LEAVE_STATUSES }).notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('leave_requests_tenant_id_key').on(t.tenantId, t.id),
    index('leave_requests_member_idx').on(t.tenantId, t.membershipId, t.startDate),
    index('leave_requests_dates_idx').on(t.tenantId, t.startDate, t.endDate),
    foreignKey({
      name: 'leave_requests_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    foreignKey({
      name: 'leave_requests_type_fk',
      columns: [t.tenantId, t.leaveTypeId],
      foreignColumns: [leaveTypes.tenantId, leaveTypes.id],
    }),
    foreignKey({
      name: 'leave_requests_file_fk',
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: 'leave_requests_decided_by_fk',
      columns: [t.tenantId, t.decidedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('leave_requests_dates', sql`${t.endDate} >= ${t.startDate}`),
    check('leave_requests_half_day', sql`${t.halfDay} = 'none' or ${t.startDate} = ${t.endDate}`),
    check('leave_requests_days', sql`${t.days} > 0`),
    check(
      'leave_requests_status_valid',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')`,
    ),
    check('leave_requests_reason_length', sql`length(${t.reason}) <= 2000`),
  ],
);

/** Balance movements. A request deducts and restores at most once each (unique key). */
export const leaveLedger = pgTable(
  'leave_ledger',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    year: integer('year').notNull(),
    kind: text('kind', { enum: LEDGER_KINDS }).notNull(),
    /** Positive adds to the balance; "taken" rows are negative. */
    days: numeric('days', { precision: 6, scale: 2 }).notNull(),
    requestId: uuid('request_id'),
    note: text('note').notNull().default(''),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('leave_ledger_tenant_id_key').on(t.tenantId, t.id),
    unique('leave_ledger_request_kind_year_key').on(t.tenantId, t.requestId, t.kind, t.year),
    index('leave_ledger_member_idx').on(t.tenantId, t.membershipId, t.leaveTypeId, t.year),
    foreignKey({
      name: 'leave_ledger_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    foreignKey({
      name: 'leave_ledger_type_fk',
      columns: [t.tenantId, t.leaveTypeId],
      foreignColumns: [leaveTypes.tenantId, leaveTypes.id],
    }),
    foreignKey({
      name: 'leave_ledger_request_fk',
      columns: [t.tenantId, t.requestId],
      foreignColumns: [leaveRequests.tenantId, leaveRequests.id],
    }),
    check('leave_ledger_kind_valid', sql`${t.kind} in ('taken', 'restored', 'adjustment')`),
    check(
      'leave_ledger_sign',
      sql`(${t.kind} = 'taken' and ${t.days} < 0) or (${t.kind} = 'restored' and ${t.days} > 0) or ${t.kind} = 'adjustment'`,
    ),
    check(
      'leave_ledger_request_needed',
      sql`${t.kind} = 'adjustment' or ${t.requestId} is not null`,
    ),
  ],
);
