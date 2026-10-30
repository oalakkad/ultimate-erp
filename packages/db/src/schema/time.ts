import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { taskAllocations, tasks } from './tasks.js';
import { memberships, tenants } from './tenancy.js';

// Timesheets & time tracking (docs/modules/timesheets.md §4).

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;

/** One person's week (Sunday–Saturday, the Kuwait work week). */
export const timesheets = pgTable(
  'timesheets',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    membershipId: uuid('membership_id').notNull(),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    status: text('status', { enum: TIMESHEET_STATUSES }).notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('timesheets_tenant_id_key').on(t.tenantId, t.id),
    unique('timesheets_tenant_member_id_key').on(t.tenantId, t.membershipId, t.id),
    unique('timesheets_tenant_member_week_key').on(t.tenantId, t.membershipId, t.weekStart),
    foreignKey({
      name: 'timesheets_member_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    check('timesheets_week_is_sunday', sql`extract(dow from ${t.weekStart}) = 0`),
    check(
      'timesheets_status_valid',
      sql`${t.status} in ('draft', 'submitted', 'approved', 'rejected')`,
    ),
  ],
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    timesheetId: uuid('timesheet_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    hours: numeric('hours', { precision: 5, scale: 2 }).notNull(),
    billable: boolean('billable').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: TIMESHEET_STATUSES }).notNull().default('draft'),
    rejectionReason: text('rejection_reason'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('time_entries_tenant_id_key').on(t.tenantId, t.id),
    index('time_entries_timesheet_idx').on(t.tenantId, t.timesheetId),
    index('time_entries_project_idx').on(t.tenantId, t.projectId, t.status),
    index('time_entries_task_idx').on(t.tenantId, t.taskId),
    index('time_entries_member_date_idx').on(t.tenantId, t.membershipId, t.workDate),
    // The entry belongs to its own person's timesheet …
    foreignKey({
      name: 'time_entries_timesheet_fk',
      columns: [t.tenantId, t.membershipId, t.timesheetId],
      foreignColumns: [timesheets.tenantId, timesheets.membershipId, timesheets.id],
    }),
    // … on a task of that project …
    foreignKey({
      name: 'time_entries_task_fk',
      columns: [t.tenantId, t.projectId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.projectId, tasks.id],
    }),
    // … that the person is assigned to.
    foreignKey({
      name: 'time_entries_allocation_fk',
      columns: [t.tenantId, t.taskId, t.membershipId],
      foreignColumns: [
        taskAllocations.tenantId,
        taskAllocations.taskId,
        taskAllocations.membershipId,
      ],
    }),
    foreignKey({
      name: 'time_entries_decided_by_fk',
      columns: [t.tenantId, t.decidedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('time_entries_hours_range', sql`${t.hours} > 0 and ${t.hours} <= 24`),
    check(
      'time_entries_status_valid',
      sql`${t.status} in ('draft', 'submitted', 'approved', 'rejected')`,
    ),
    check('time_entries_description_length', sql`length(${t.description}) <= 2000`),
    check(
      'time_entries_rejection_reason',
      sql`${t.status} <> 'rejected' or ${t.rejectionReason} is not null`,
    ),
  ],
);

/** At most one running timer per person. */
export const timeTimers = pgTable(
  'time_timers',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    membershipId: uuid('membership_id').notNull(),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'time_timers_pkey', columns: [t.tenantId, t.membershipId] }),
    foreignKey({
      name: 'time_timers_task_fk',
      columns: [t.tenantId, t.projectId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.projectId, tasks.id],
    }),
    foreignKey({
      name: 'time_timers_allocation_fk',
      columns: [t.tenantId, t.taskId, t.membershipId],
      foreignColumns: [
        taskAllocations.tenantId,
        taskAllocations.taskId,
        taskAllocations.membershipId,
      ],
    }),
  ],
);
