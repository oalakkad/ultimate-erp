import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './columns.js';
import { employees } from './people.js';
import { memberships, tenants } from './tenancy.js';

// Attendance (docs/modules/attendance.md §3).

export const ATTENDANCE_KINDS = ['in', 'out'] as const;
export const ATTENDANCE_METHODS = ['qr', 'web', 'manual'] as const;
export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const;

const tenantColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

/** Company settings by key (attendance rules now, payroll rules in Phase 11); values validated by the API. */
export const companySettings = pgTable(
  'company_settings',
  {
    tenantId: tenantColumn(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'company_settings_pkey', columns: [t.tenantId, t.key] }),
    check('company_settings_key', sql`${t.key} ~ '^[a-z][a-z0-9_.]{1,79}$'`),
  ],
);

export const attendanceSites = pgTable(
  'attendance_sites',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique('attendance_sites_tenant_id_key').on(t.tenantId, t.id)],
);

export const shifts = pgTable(
  'shifts',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    graceMinutes: integer('grace_minutes').notNull().default(10),
    breakMinutes: integer('break_minutes').notNull().default(60),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('shifts_tenant_id_key').on(t.tenantId, t.id),
    check('shifts_order', sql`${t.endTime} > ${t.startTime}`),
    check(
      'shifts_minutes',
      sql`${t.graceMinutes} between 0 and 240 and ${t.breakMinutes} between 0 and 480`,
    ),
  ],
);

export const shiftAssignments = pgTable(
  'shift_assignments',
  {
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'shift_assignments_pkey', columns: [t.tenantId, t.membershipId] }),
    foreignKey({
      name: 'shift_assignments_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    foreignKey({
      name: 'shift_assignments_shift_fk',
      columns: [t.tenantId, t.shiftId],
      foreignColumns: [shifts.tenantId, shifts.id],
    }),
  ],
);

export const attendanceCorrections = pgTable(
  'attendance_corrections',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    /** The moment the person says they checked in or out (server stores it as given, Kuwait time). */
    at: timestamp('at', { withTimezone: true }).notNull(),
    kind: text('kind', { enum: ATTENDANCE_KINDS }).notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: CORRECTION_STATUSES }).notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('attendance_corrections_tenant_id_key').on(t.tenantId, t.id),
    index('attendance_corrections_member_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'attendance_corrections_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    foreignKey({
      name: 'attendance_corrections_decided_by_fk',
      columns: [t.tenantId, t.decidedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('attendance_corrections_kind', sql`${t.kind} in ('in', 'out')`),
    check('attendance_corrections_status', sql`${t.status} in ('pending', 'approved', 'rejected')`),
    check('attendance_corrections_reason', sql`length(trim(${t.reason})) between 1 and 1000`),
  ],
);

/** Append-only check-in / check-out record; `at` is always server time (or an approved correction). */
export const attendanceEvents = pgTable(
  'attendance_events',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    kind: text('kind', { enum: ATTENDANCE_KINDS }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    method: text('method', { enum: ATTENDANCE_METHODS }).notNull(),
    siteId: uuid('site_id'),
    correctionId: uuid('correction_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('attendance_events_tenant_id_key').on(t.tenantId, t.id),
    unique('attendance_events_correction_key').on(t.tenantId, t.correctionId),
    index('attendance_events_member_at_idx').on(t.tenantId, t.membershipId, t.at),
    foreignKey({
      name: 'attendance_events_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    foreignKey({
      name: 'attendance_events_site_fk',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [attendanceSites.tenantId, attendanceSites.id],
    }),
    foreignKey({
      name: 'attendance_events_correction_fk',
      columns: [t.tenantId, t.correctionId],
      foreignColumns: [attendanceCorrections.tenantId, attendanceCorrections.id],
    }),
    check('attendance_events_kind', sql`${t.kind} in ('in', 'out')`),
    check('attendance_events_method', sql`${t.method} in ('qr', 'web', 'manual')`),
    check('attendance_events_qr_site', sql`${t.method} <> 'qr' or ${t.siteId} is not null`),
    check(
      'attendance_events_manual',
      sql`(${t.method} = 'manual') = (${t.correctionId} is not null)`,
    ),
  ],
);

/** One use of a kiosk code per person per window (replay protection). */
export const attendanceCodeUses = pgTable(
  'attendance_code_uses',
  {
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    siteId: uuid('site_id').notNull(),
    window: bigint('window', { mode: 'number' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'attendance_code_uses_pkey',
      columns: [t.tenantId, t.membershipId, t.siteId, t.window],
    }),
    foreignKey({
      name: 'attendance_code_uses_site_fk',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [attendanceSites.tenantId, attendanceSites.id],
    }),
  ],
);
