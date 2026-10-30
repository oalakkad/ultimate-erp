import { sql } from 'drizzle-orm';
import {
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
import { files } from './files.js';
import { projectMembers, projects } from './projects.js';
import { memberships, tenants } from './tenancy.js';

// Tasks & hour allocation (docs/modules/tasks.md §4).

export const TASK_STATUSES = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'completed',
  'cancelled',
] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const tasks = pgTable(
  'tasks',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: uuid('project_id').notNull(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('backlog'),
    priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('normal'),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    estimatedHours: numeric('estimated_hours', { precision: 10, scale: 2 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Kuwait date of the last overdue alert, so the daily job alerts once per day. */
    overdueNotifiedOn: date('overdue_notified_on', { mode: 'string' }),
    createdByUserId: uuid('created_by_user_id').notNull(),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    unique('tasks_tenant_id_id_key').on(t.tenantId, t.id),
    unique('tasks_tenant_project_id_key').on(t.tenantId, t.projectId, t.id),
    unique('tasks_tenant_number_key').on(t.tenantId, t.number),
    index('tasks_tenant_project_idx').on(t.tenantId, t.projectId),
    index('tasks_tenant_due_idx').on(t.tenantId, t.dueDate),
    foreignKey({
      name: 'tasks_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }),
    foreignKey({
      name: 'tasks_created_by_fk',
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check(
      'tasks_status_valid',
      sql`${t.status} in ('backlog', 'ready', 'in_progress', 'in_review', 'completed', 'cancelled')`,
    ),
    check('tasks_priority_valid', sql`${t.priority} in ('low', 'normal', 'high', 'urgent')`),
    check(
      'tasks_dates_ordered',
      sql`${t.dueDate} is null or ${t.startDate} is null or ${t.dueDate} >= ${t.startDate}`,
    ),
    check(
      'tasks_estimate_nonnegative',
      sql`${t.estimatedHours} is null or ${t.estimatedHours} >= 0`,
    ),
    check('tasks_title_length', sql`length(trim(${t.title})) between 1 and 300`),
  ],
);

/** Planned hours per person per task. Assignees must be on the project team (composite FK). */
export const taskAllocations = pgTable(
  'task_allocations',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    taskId: uuid('task_id').notNull(),
    projectId: uuid('project_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    hours: numeric('hours', { precision: 10, scale: 2 }).notNull(),
    allocatedByUserId: uuid('allocated_by_user_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({
      name: 'task_allocations_pkey',
      columns: [t.tenantId, t.taskId, t.membershipId],
    }),
    index('task_allocations_project_idx').on(t.tenantId, t.projectId),
    index('task_allocations_membership_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'task_allocations_task_fk',
      columns: [t.tenantId, t.projectId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.projectId, tasks.id],
    }),
    foreignKey({
      name: 'task_allocations_team_fk',
      columns: [t.tenantId, t.projectId, t.membershipId],
      foreignColumns: [
        projectMembers.tenantId,
        projectMembers.projectId,
        projectMembers.membershipId,
      ],
    }),
    foreignKey({
      name: 'task_allocations_by_fk',
      columns: [t.tenantId, t.allocatedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('task_allocations_hours_nonnegative', sql`${t.hours} >= 0`),
  ],
);

/** "Task is blocked by" — both tasks in the same project. */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: uuid('project_id').notNull(),
    taskId: uuid('task_id').notNull(),
    blockedByTaskId: uuid('blocked_by_task_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'task_dependencies_pkey',
      columns: [t.tenantId, t.taskId, t.blockedByTaskId],
    }),
    foreignKey({
      name: 'task_dependencies_task_fk',
      columns: [t.tenantId, t.projectId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.projectId, tasks.id],
    }),
    foreignKey({
      name: 'task_dependencies_blocker_fk',
      columns: [t.tenantId, t.projectId, t.blockedByTaskId],
      foreignColumns: [tasks.tenantId, tasks.projectId, tasks.id],
    }),
    check('task_dependencies_not_self', sql`${t.taskId} <> ${t.blockedByTaskId}`),
  ],
);

/** Comments are append-only for the app. */
export const taskComments = pgTable(
  'task_comments',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    taskId: uuid('task_id').notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('task_comments_tenant_id_key').on(t.tenantId, t.id),
    index('task_comments_task_idx').on(t.tenantId, t.taskId),
    foreignKey({
      name: 'task_comments_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
    foreignKey({
      name: 'task_comments_author_fk',
      columns: [t.tenantId, t.authorUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    check('task_comments_body_length', sql`length(trim(${t.body})) between 1 and 4000`),
  ],
);

export const taskDocuments = pgTable(
  'task_documents',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    taskId: uuid('task_id').notNull(),
    fileId: uuid('file_id').notNull(),
    addedByUserId: uuid('added_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'task_documents_pkey', columns: [t.tenantId, t.taskId, t.fileId] }),
    unique('task_documents_tenant_file_key').on(t.tenantId, t.fileId),
    foreignKey({
      name: 'task_documents_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
    foreignKey({
      name: 'task_documents_file_fk',
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    foreignKey({
      name: 'task_documents_added_by_fk',
      columns: [t.tenantId, t.addedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
  ],
);
