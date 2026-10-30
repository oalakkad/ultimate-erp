import { z } from 'zod';
import { moneySchema } from './agreements.js';
import { fileSchema } from './files.js';

// Projects / engagements & budgeting (docs/modules/projects.md §7).

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export const BILLING_METHODS = [
  'fixed_price',
  'time_and_materials',
  'retainer',
  'non_billable',
] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const billingMethodSchema = z.enum(BILLING_METHODS);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type BillingMethod = z.infer<typeof billingMethodSchema>;

/** Allowed status moves (docs/modules/projects.md §6). */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  planned: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Hours travel as decimal strings with up to 2 decimals (e.g. "100", "37.5"); never floats. */
export const hoursSchema = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'hours');
const isoDate = z.iso.date();

const detailFields = {
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    .max(4000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  contractId: z.uuid().nullable().optional(),
  managerMembershipId: z.uuid(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  billingMethod: billingMethodSchema.optional(),
};
const datesOrdered = (v: {
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
}) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

export const createProjectRequestSchema = z
  .object({
    clientId: z.uuid(),
    ...detailFields,
    budgetHours: hoursSchema,
    budgetAmount: moneySchema.nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((v) => v.toUpperCase())
      .optional(),
    /** Team members besides the manager (membership IDs). */
    memberIds: z.array(z.uuid()).max(200).optional(),
  })
  .strict()
  .refine(datesOrdered, { path: ['endDate'], message: 'before_start' });

export const updateProjectRequestSchema = z
  .object(detailFields)
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict()
  .refine(datesOrdered, { path: ['endDate'], message: 'before_start' });

export const projectStatusRequestSchema = z.object({ status: projectStatusSchema }).strict();

export const budgetRevisionRequestSchema = z
  .object({
    budgetHours: hoursSchema,
    budgetAmount: moneySchema.nullable().optional(),
    reason: z.string().trim().min(1).max(1000),
    /** Reducing the budget below hours already allocated needs projects.budget.override. */
    override: z.boolean().optional(),
  })
  .strict();

export const setMembersRequestSchema = z.object({ memberIds: z.array(z.uuid()).max(200) }).strict();

const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();
const personRef = z.object({ membershipId: z.uuid(), name: z.string() }).strict();

export const projectSummarySchema = z
  .object({
    id: z.uuid(),
    number: z.string(),
    name: bilingual,
    client: z.object({ id: z.uuid(), number: z.string(), name: bilingual }).strict(),
    status: projectStatusSchema,
    manager: personRef.nullable(),
    startDate: isoDate.nullable(),
    endDate: isoDate.nullable(),
    budgetHours: hoursSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const PROJECT_ACTIONS = ['edit', 'budget', 'team', 'status'] as const;

export const projectSchema = projectSummarySchema
  .extend({
    description: z.string().nullable(),
    contract: z.object({ id: z.uuid(), number: z.string(), title: bilingual }).strict().nullable(),
    billingMethod: billingMethodSchema,
    budgetAmount: moneySchema.nullable(),
    currency: z.string(),
    budgetRevision: z.number().int(),
    members: z.array(personRef),
    /** Next statuses this person may set. */
    nextStatuses: z.array(projectStatusSchema),
    actions: z.array(z.enum(PROJECT_ACTIONS)),
    version: z.number().int(),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;

export const budgetRevisionSchema = z
  .object({
    revisionNo: z.number().int(),
    budgetHours: hoursSchema,
    budgetAmount: moneySchema.nullable(),
    reason: z.string(),
    changedByName: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const budgetRevisionListResponseSchema = z
  .object({ items: z.array(budgetRevisionSchema) })
  .strict();

/**
 * The five hour measures, kept apart (docs/modules/projects.md §3). Allocated comes from task
 * allocations (Phase 6), logged / approved / billable from timesheets (Phase 7); until those
 * exist they are genuinely 0.
 */
export const projectHoursSchema = z
  .object({
    budgeted: hoursSchema,
    allocated: hoursSchema,
    remaining: z.string(),
    logged: hoursSchema,
    approved: hoursSchema,
    billable: hoursSchema,
    /** `approaching` at 80 % of the budget allocated or approved, `exceeded` above 100 %. */
    warning: z.enum(['none', 'approaching', 'exceeded']),
  })
  .strict();

export const projectListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: projectStatusSchema.optional(),
    clientId: z.uuid().optional(),
    mine: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();
export const projectListResponseSchema = z
  .object({ items: z.array(projectSummarySchema), nextCursor: z.string().nullable() })
  .strict();
export const projectIdParamSchema = z.object({ id: z.uuid() }).strict();
export const projectChildParamSchema = z.object({ id: z.uuid(), childId: z.uuid() }).strict();

export const projectDocumentSchema = z
  .object({ file: fileSchema, addedAt: z.iso.datetime(), addedByName: z.string().nullable() })
  .strict();
export const projectDocumentListResponseSchema = z
  .object({ items: z.array(projectDocumentSchema) })
  .strict();

export const PROJECT_ACTIVITY_ACTIONS = [
  'projects.project.created',
  'projects.project.updated',
  'projects.project.status_changed',
  'projects.project.team_changed',
  'projects.budget.revised',
  'projects.document.attached',
  'projects.document.detached',
] as const;

export const projectActivitySchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.uuid(),
          action: z.enum(PROJECT_ACTIVITY_ACTIONS),
          occurredAt: z.iso.datetime(),
          actorName: z.string().nullable(),
          /** Field names only (never values), for "updated" entries. */
          fields: z.array(z.string()),
          /** Status or budget before / after, where it applies. */
          from: z.string().nullable(),
          to: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
