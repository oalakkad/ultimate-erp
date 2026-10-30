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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './columns.js';
import { files } from './files.js';
import { memberships, tenants } from './tenancy.js';

// Employees & teams (docs/modules/people.md §3).

export const EMPLOYEE_STATUSES = [
  'onboarding',
  'active',
  'on_leave',
  'offboarding',
  'left',
] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contractor', 'intern'] as const;
export const EMPLOYEE_DOCUMENT_CATEGORIES = [
  'contract',
  'identity',
  'certificate',
  'other',
] as const;

const tenantColumn = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id);

export const departments = pgTable(
  'departments',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('departments_tenant_id_key').on(t.tenantId, t.id),
    check(
      'departments_names',
      sql`length(trim(${t.nameEn})) between 1 and 200 and length(trim(${t.nameAr})) between 1 and 200`,
    ),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    departmentId: uuid('department_id'),
    leadMembershipId: uuid('lead_membership_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('teams_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'teams_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    foreignKey({
      name: 'teams_lead_fk',
      columns: [t.tenantId, t.leadMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    check(
      'teams_names',
      sql`length(trim(${t.nameEn})) between 1 and 200 and length(trim(${t.nameAr})) between 1 and 200`,
    ),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    tenantId: tenantColumn(),
    teamId: uuid('team_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'team_members_pkey', columns: [t.tenantId, t.teamId, t.membershipId] }),
    index('team_members_membership_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'team_members_team_fk',
      columns: [t.tenantId, t.teamId],
      foreignColumns: [teams.tenantId, teams.id],
    }),
    foreignKey({
      name: 'team_members_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
  ],
);

/** The HR record of a member; one per membership. */
export const employees = pgTable(
  'employees',
  {
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    number: text('number').notNull(),
    jobTitleEn: text('job_title_en').notNull().default(''),
    jobTitleAr: text('job_title_ar').notNull().default(''),
    departmentId: uuid('department_id'),
    managerMembershipId: uuid('manager_membership_id'),
    status: text('status', { enum: EMPLOYEE_STATUSES }).notNull().default('onboarding'),
    employmentType: text('employment_type', { enum: EMPLOYMENT_TYPES })
      .notNull()
      .default('full_time'),
    joinDate: date('join_date', { mode: 'string' }),
    leaveDate: date('leave_date', { mode: 'string' }),
    /** Contracted hours a week (capacity), not a legal statement. */
    weeklyHours: numeric('weekly_hours', { precision: 5, scale: 2 }).notNull().default('40'),
    /** Working days, 0 = Sunday … 6 = Saturday. */
    workDays: integer('work_days')
      .array()
      .notNull()
      .default(sql`'{0,1,2,3,4}'::integer[]`),
    version: versionColumn(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'employees_pkey', columns: [t.tenantId, t.membershipId] }),
    unique('employees_tenant_number_key').on(t.tenantId, t.number),
    index('employees_manager_idx').on(t.tenantId, t.managerMembershipId),
    foreignKey({
      name: 'employees_membership_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    foreignKey({
      name: 'employees_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    foreignKey({
      name: 'employees_manager_fk',
      columns: [t.tenantId, t.managerMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
    check(
      'employees_not_own_manager',
      sql`${t.managerMembershipId} is null or ${t.managerMembershipId} <> ${t.membershipId}`,
    ),
    check(
      'employees_status_valid',
      sql`${t.status} in ('onboarding', 'active', 'on_leave', 'offboarding', 'left')`,
    ),
    check(
      'employees_type_valid',
      sql`${t.employmentType} in ('full_time', 'part_time', 'contractor', 'intern')`,
    ),
    check(
      'employees_dates_ordered',
      sql`${t.leaveDate} is null or ${t.joinDate} is null or ${t.leaveDate} >= ${t.joinDate}`,
    ),
    check('employees_left_has_date', sql`${t.status} <> 'left' or ${t.leaveDate} is not null`),
    check('employees_weekly_hours', sql`${t.weeklyHours} >= 0 and ${t.weeklyHours} <= 80`),
    check('employees_work_days', sql`${t.workDays} <@ '{0,1,2,3,4,5,6}'::integer[]`),
  ],
);

/** Encrypted private details (FieldCipher); `civilIdHash` is a keyed hash for uniqueness only. */
export const employeePrivate = pgTable(
  'employee_private',
  {
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    sealed: text('sealed').notNull(),
    civilIdHash: text('civil_id_hash'),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'employee_private_pkey', columns: [t.tenantId, t.membershipId] }),
    unique('employee_private_civil_id_key').on(t.tenantId, t.civilIdHash),
    foreignKey({
      name: 'employee_private_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
  ],
);

export const employeeEmergencyContacts = pgTable(
  'employee_emergency_contacts',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    /** Name, relationship and phone, encrypted together (FieldCipher). */
    sealed: text('sealed').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('employee_emergency_contacts_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'employee_emergency_contacts_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
  ],
);

/** Append-only record of employment changes (never private details). */
export const employeeHistory = pgTable(
  'employee_history',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    kind: text('kind').notNull(),
    changes: jsonb('changes')
      .$type<Record<string, { from: unknown; to: unknown }>>()
      .notNull()
      .default({}),
    changedByUserId: uuid('changed_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('employee_history_tenant_id_key').on(t.tenantId, t.id),
    index('employee_history_member_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'employee_history_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
  ],
);

export const employeeDocuments = pgTable(
  'employee_documents',
  {
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    fileId: uuid('file_id').notNull(),
    category: text('category', { enum: EMPLOYEE_DOCUMENT_CATEGORIES }).notNull().default('other'),
    /** Confidential documents are shown only to restricted readers. */
    confidential: boolean('confidential').notNull().default(true),
    addedByUserId: uuid('added_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'employee_documents_pkey',
      columns: [t.tenantId, t.membershipId, t.fileId],
    }),
    unique('employee_documents_tenant_file_key').on(t.tenantId, t.fileId),
    foreignKey({
      name: 'employee_documents_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    foreignKey({
      name: 'employee_documents_file_fk',
      columns: [t.tenantId, t.fileId],
      foreignColumns: [files.tenantId, files.id],
    }),
    check(
      'employee_documents_category_valid',
      sql`${t.category} in ('contract', 'identity', 'certificate', 'other')`,
    ),
  ],
);

export const employeeChecklistItems = pgTable(
  'employee_checklist_items',
  {
    id: idColumn(),
    tenantId: tenantColumn(),
    membershipId: uuid('membership_id').notNull(),
    kind: text('kind', { enum: ['onboarding', 'offboarding'] }).notNull(),
    /** A built-in item key (translated in the UI) or a custom title. */
    title: text('title').notNull(),
    position: integer('position').notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneByUserId: uuid('done_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('employee_checklist_items_tenant_id_key').on(t.tenantId, t.id),
    index('employee_checklist_items_member_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'employee_checklist_items_employee_fk',
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [employees.tenantId, employees.membershipId],
    }),
    check('employee_checklist_items_kind_valid', sql`${t.kind} in ('onboarding', 'offboarding')`),
  ],
);
