import { z } from 'zod';
import { fileSchema } from './files.js';
import { hoursSchema } from './projects.js';

// Tasks & hour allocation (docs/modules/tasks.md §7).

export const TASK_STATUSES = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'completed',
  'cancelled',
] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** Allowed status moves (docs/modules/tasks.md §6). Reopening a completed task needs tasks.task.manage. */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['ready', 'in_progress', 'cancelled'],
  ready: ['backlog', 'in_progress', 'cancelled'],
  in_progress: ['ready', 'in_review', 'completed', 'cancelled'],
  in_review: ['in_progress', 'completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: [],
};
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
];

const isoDate = z.iso.date();
const datesOrdered = (v: {
  startDate?: string | null | undefined;
  dueDate?: string | null | undefined;
}) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate;

export const allocationInputSchema = z
  .object({ membershipId: z.uuid(), hours: hoursSchema })
  .strict();
const allocationsField = z
  .array(allocationInputSchema)
  .max(50)
  .refine((list) => new Set(list.map((a) => a.membershipId)).size === list.length, {
    message: 'duplicate',
  });
/** Going beyond the project's remaining hours needs projects.budget.override and a reason. */
const overrideFields = {
  override: z.boolean().optional(),
  overrideReason: z.string().trim().min(1).max(1000).optional(),
};

const detailFields = {
  title: z.string().trim().min(1).max(300),
  description: z
    .string()
    .trim()
    .max(8000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  priority: taskPrioritySchema.optional(),
  startDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  estimatedHours: hoursSchema.nullable().optional(),
};

export const createTaskRequestSchema = z
  .object({
    projectId: z.uuid(),
    ...detailFields,
    status: z.enum(['backlog', 'ready']).optional(),
    allocations: allocationsField.optional(),
    ...overrideFields,
  })
  .strict()
  .refine(datesOrdered, { path: ['dueDate'], message: 'before_start' });

export const updateTaskRequestSchema = z
  .object(detailFields)
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict()
  .refine(datesOrdered, { path: ['dueDate'], message: 'before_start' });

export const taskStatusRequestSchema = z.object({ status: taskStatusSchema }).strict();

export const setAllocationsRequestSchema = z
  .object({ allocations: allocationsField, ...overrideFields })
  .strict();

export const allocationPreviewRequestSchema = z
  .object({
    projectId: z.uuid(),
    /** Leave out for a new task; with it, that task's current allocations are replaced. */
    taskId: z.uuid().optional(),
    allocations: allocationsField,
  })
  .strict();

export const setDependenciesRequestSchema = z
  .object({ blockedBy: z.array(z.uuid()).max(50) })
  .strict();
export const commentRequestSchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();

const personRef = z.object({ membershipId: z.uuid(), name: z.string() }).strict();
const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();

export const allocationSchema = personRef.extend({ hours: hoursSchema }).strict();

export const taskSummarySchema = z
  .object({
    id: z.uuid(),
    number: z.string(),
    title: z.string(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    project: z.object({ id: z.uuid(), number: z.string(), name: bilingual }).strict(),
    client: z.object({ id: z.uuid(), name: bilingual }).strict(),
    startDate: isoDate.nullable(),
    dueDate: isoDate.nullable(),
    overdue: z.boolean(),
    allocations: z.array(allocationSchema),
    allocatedHours: hoursSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const TASK_ACTIONS = ['edit', 'allocate', 'dependencies', 'comment', 'documents'] as const;

export const taskSchema = taskSummarySchema
  .extend({
    description: z.string().nullable(),
    estimatedHours: hoursSchema.nullable(),
    completedAt: z.iso.datetime().nullable(),
    blockedBy: z.array(
      z
        .object({ id: z.uuid(), number: z.string(), title: z.string(), status: taskStatusSchema })
        .strict(),
    ),
    /** Next statuses this person may set now (blocked tasks cannot start). */
    nextStatuses: z.array(taskStatusSchema),
    actions: z.array(z.enum(TASK_ACTIONS)),
    version: z.number().int(),
  })
  .strict();
export type Task = z.infer<typeof taskSchema>;

export const taskListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    projectId: z.uuid().optional(),
    clientId: z.uuid().optional(),
    status: taskStatusSchema.optional(),
    /** `open` = backlog, ready, in progress, in review. */
    state: z.enum(['open', 'closed']).optional(),
    priority: taskPrioritySchema.optional(),
    assignee: z.union([z.literal('me'), z.uuid()]).optional(),
    overdue: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.uuid().optional(),
  })
  .strict();
export const taskListResponseSchema = z
  .object({ items: z.array(taskSummarySchema), nextCursor: z.string().nullable() })
  .strict();
export const taskIdParamSchema = z.object({ id: z.uuid() }).strict();
export const taskChildParamSchema = z.object({ id: z.uuid(), childId: z.uuid() }).strict();

/** What an allocation would do — shown before saving (workflow steps 7–8). */
export const allocationPreviewSchema = z
  .object({
    budgeted: hoursSchema,
    /** Allocated on the project's other tasks (excluding this task). */
    allocatedElsewhere: hoursSchema,
    thisTask: hoursSchema,
    /** May be negative: then the allocation is over budget. */
    remainingAfter: z.string(),
    overBudget: z.boolean(),
    /** Whether this person may confirm an over-budget allocation (with a reason). */
    canOverride: z.boolean(),
    people: z.array(
      personRef
        .extend({
          hours: hoursSchema,
          /** Allocated on open tasks elsewhere (all projects), before this change. */
          openWorkload: hoursSchema,
          onTeam: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const workloadSchema = z
  .object({
    items: z.array(
      personRef
        .extend({
          openTasks: z.number().int(),
          openHours: hoursSchema,
          overdueTasks: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();
export const workloadQuerySchema = z.object({ projectId: z.uuid().optional() }).strict();

export const commentSchema = z
  .object({
    id: z.uuid(),
    body: z.string(),
    authorName: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const commentListResponseSchema = z.object({ items: z.array(commentSchema) }).strict();

export const taskDocumentListResponseSchema = z
  .object({
    items: z.array(
      z
        .object({ file: fileSchema, addedAt: z.iso.datetime(), addedByName: z.string().nullable() })
        .strict(),
    ),
  })
  .strict();

export const TASK_ACTIVITY_ACTIONS = [
  'tasks.task.created',
  'tasks.task.updated',
  'tasks.task.status_changed',
  'tasks.allocation.changed',
  'tasks.allocation.override',
  'tasks.dependency.changed',
  'tasks.comment.added',
  'tasks.document.attached',
  'tasks.document.detached',
] as const;
export const taskActivitySchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.uuid(),
          action: z.enum(TASK_ACTIVITY_ACTIONS),
          occurredAt: z.iso.datetime(),
          actorName: z.string().nullable(),
          fields: z.array(z.string()),
          from: z.string().nullable(),
          to: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
