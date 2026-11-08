import { z } from 'zod';
import { fileSchema } from './files.js';
import { EMPTY_UPDATE, hasAnyField } from './update.js';

// Employees & teams (docs/modules/people.md §7).

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
export const employeeStatusSchema = z.enum(EMPLOYEE_STATUSES);
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

/** Allowed status moves (docs/modules/people.md §6). */
export const EMPLOYEE_TRANSITIONS: Record<EmployeeStatus, readonly EmployeeStatus[]> = {
  onboarding: ['active', 'left'],
  active: ['on_leave', 'offboarding'],
  on_leave: ['active', 'offboarding'],
  offboarding: ['active', 'left'],
  left: [],
};

/** Built-in checklist items (translated in the UI); companies can add their own titles. */
export const ONBOARDING_ITEMS = [
  'contract_signed',
  'documents_collected',
  'accounts_created',
  'equipment_issued',
  'induction_done',
] as const;
export const OFFBOARDING_ITEMS = [
  'handover_done',
  'equipment_returned',
  'access_removed',
  'final_settlement',
  'exit_interview',
] as const;

const isoDate = z.iso.date();
const text = (max: number) => z.string().trim().max(max);
const weeklyHoursSchema = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, 'hours');
const workDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine((d) => new Set(d).size === d.length, { message: 'duplicate' });

const employmentFields = {
  jobTitleEn: text(200).optional(),
  jobTitleAr: text(200).optional(),
  departmentId: z.uuid().nullable().optional(),
  managerMembershipId: z.uuid().nullable().optional(),
  employmentType: employmentTypeSchema.optional(),
  joinDate: isoDate.nullable().optional(),
  weeklyHours: weeklyHoursSchema.optional(),
  workDays: workDaysSchema.optional(),
};

export const createEmployeeRequestSchema = z
  .object({ membershipId: z.uuid(), ...employmentFields })
  .strict();
export const updateEmployeeRequestSchema = z
  .object(employmentFields)
  .extend({ version: z.number().int().positive() })
  .strict();
export const employeeStatusRequestSchema = z
  .object({ status: employeeStatusSchema, leaveDate: isoDate.optional() })
  .strict();

export const privateDetailsSchema = z
  .object({
    civilId: text(40).optional(),
    nationality: text(80).optional(),
    birthDate: isoDate.nullable().optional(),
    personalPhone: text(40).optional(),
    personalEmail: z.union([z.literal(''), z.email().max(254)]).optional(),
    address: text(500).optional(),
    bankName: text(120).optional(),
    iban: text(40).optional(),
  })
  .strict();
export type PrivateDetails = z.infer<typeof privateDetailsSchema>;

export const emergencyContactRequestSchema = z
  .object({ name: text(200).min(1), relationship: text(80).min(1), phone: text(40).min(1) })
  .strict();
export const emergencyContactSchema = emergencyContactRequestSchema
  .extend({ id: z.uuid() })
  .strict();
export const emergencyContactListResponseSchema = z
  .object({ items: z.array(emergencyContactSchema) })
  .strict();

const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();
const personRef = z.object({ membershipId: z.uuid(), name: z.string() }).strict();
const ref = z.object({ id: z.uuid(), name: bilingual }).strict();

export const employeeSummarySchema = z
  .object({
    membershipId: z.uuid(),
    number: z.string(),
    name: z.string(),
    jobTitle: bilingual,
    department: ref.nullable(),
    teams: z.array(ref),
    manager: personRef.nullable(),
    status: employeeStatusSchema,
  })
  .strict();
export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;

export const EMPLOYEE_ACTIONS = ['edit', 'status', 'private', 'documents', 'checklist'] as const;

export const employeeSchema = employeeSummarySchema
  .extend({
    email: z.string(),
    /** Employment details; null when this person may only see the directory entry. */
    details: z
      .object({
        employmentType: employmentTypeSchema,
        joinDate: isoDate.nullable(),
        leaveDate: isoDate.nullable(),
        weeklyHours: z.string(),
        workDays: z.array(z.number().int()),
      })
      .strict()
      .nullable(),
    canSeeRestricted: z.boolean(),
    nextStatuses: z.array(employeeStatusSchema),
    actions: z.array(z.enum(EMPLOYEE_ACTIONS)),
    version: z.number().int(),
  })
  .strict();
export type Employee = z.infer<typeof employeeSchema>;

export const employeeListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    departmentId: z.uuid().optional(),
    teamId: z.uuid().optional(),
    status: employeeStatusSchema.optional(),
  })
  .strict();
export const employeeListResponseSchema = z
  .object({ items: z.array(employeeSummarySchema) })
  .strict();
export const employeeCandidatesResponseSchema = z
  .object({ items: z.array(personRef.extend({ email: z.string() }).strict()) })
  .strict();
export const membershipParamSchema = z.object({ id: z.uuid() }).strict();
export const membershipChildParamSchema = z.object({ id: z.uuid(), childId: z.uuid() }).strict();

export const privateDetailsResponseSchema = z
  .object({ details: privateDetailsSchema, updatedAt: z.iso.datetime().nullable() })
  .strict();

export const employeeHistorySchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.uuid(),
          kind: z.string(),
          changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() }).strict()),
          changedByName: z.string().nullable(),
          createdAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict();

export const checklistItemSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['onboarding', 'offboarding']),
    /** `builtin:<key>` for the standard items, otherwise the company's own title. */
    title: z.string(),
    done: z.boolean(),
    doneAt: z.iso.datetime().nullable(),
    doneByName: z.string().nullable(),
  })
  .strict();
export const checklistResponseSchema = z.object({ items: z.array(checklistItemSchema) }).strict();
export const checklistItemUpdateSchema = z.object({ done: z.boolean() }).strict();
export const checklistItemCreateSchema = z
  .object({ kind: z.enum(['onboarding', 'offboarding']), title: text(200).min(1) })
  .strict();

export const employeeDocumentRequestSchema = z
  .object({
    fileId: z.uuid(),
    category: z.enum(EMPLOYEE_DOCUMENT_CATEGORIES).optional(),
    confidential: z.boolean().optional(),
  })
  .strict();
export const employeeDocumentListResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          file: fileSchema,
          category: z.enum(EMPLOYEE_DOCUMENT_CATEGORIES),
          confidential: z.boolean(),
          addedAt: z.iso.datetime(),
          addedByName: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

// --- organisation --------------------------------------------------------------------------

const bilingualName = { nameEn: text(200).min(1), nameAr: text(200).min(1) };
export const departmentRequestSchema = z.object(bilingualName).strict();
export const departmentUpdateSchema = z
  .object({ ...bilingualName, archived: z.boolean() })
  .partial()
  .strict()
  .refine(hasAnyField, EMPTY_UPDATE);
export const departmentSchema = z
  .object({ id: z.uuid(), name: bilingual, archived: z.boolean(), people: z.number().int() })
  .strict();
export const departmentListResponseSchema = z.object({ items: z.array(departmentSchema) }).strict();

export const teamRequestSchema = z
  .object({
    ...bilingualName,
    departmentId: z.uuid().nullable().optional(),
    leadMembershipId: z.uuid().nullable().optional(),
  })
  .strict();
export const teamUpdateSchema = teamRequestSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict()
  .refine(hasAnyField, EMPTY_UPDATE);
export const teamSchema = z
  .object({
    id: z.uuid(),
    name: bilingual,
    department: ref.nullable(),
    lead: personRef.nullable(),
    members: z.array(personRef),
    archived: z.boolean(),
  })
  .strict();
export const teamListResponseSchema = z.object({ items: z.array(teamSchema) }).strict();
export const teamMembersRequestSchema = z
  .object({ memberIds: z.array(z.uuid()).max(500) })
  .strict();
export const orgIdParamSchema = z.object({ id: z.uuid() }).strict();

export const orgChartSchema = z
  .object({
    nodes: z.array(
      z
        .object({
          membershipId: z.uuid(),
          name: z.string(),
          jobTitle: bilingual,
          managerMembershipId: z.uuid().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
