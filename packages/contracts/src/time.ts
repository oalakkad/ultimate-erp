import { z } from 'zod';
import { hoursSchema } from './projects.js';

// Timesheets & time tracking (docs/modules/timesheets.md §7).

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export const timesheetStatusSchema = z.enum(TIMESHEET_STATUSES);
export type TimesheetStatus = z.infer<typeof timesheetStatusSchema>;

const isoDate = z.iso.date();
/** Logged hours: more than 0, at most 24, up to 2 decimals. */
export const entryHoursSchema = hoursSchema.refine((h) => Number(h) > 0 && Number(h) <= 24, {
  message: 'hours_range',
});

export const createTimeEntryRequestSchema = z
  .object({
    taskId: z.uuid(),
    workDate: isoDate,
    hours: entryHoursSchema,
    billable: z.boolean().optional(),
    description: z.string().trim().max(2000).optional(),
    /** Set after the "this looks like a duplicate" warning to save it anyway. */
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();

export const updateTimeEntryRequestSchema = z
  .object({
    workDate: isoDate.optional(),
    hours: entryHoursSchema.optional(),
    billable: z.boolean().optional(),
    description: z.string().trim().max(2000).optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const entryIdsRequestSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) }).strict();
export const rejectEntriesRequestSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(200), reason: z.string().trim().min(1).max(1000) })
  .strict();
export const reopenEntryRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export const timerStartRequestSchema = z.object({ taskId: z.uuid() }).strict();
export const timerStopRequestSchema = z
  .object({ description: z.string().trim().max(2000).optional() })
  .strict();

const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();

export const timeEntrySchema = z
  .object({
    id: z.uuid(),
    workDate: isoDate,
    hours: hoursSchema,
    billable: z.boolean(),
    description: z.string(),
    status: timesheetStatusSchema,
    rejectionReason: z.string().nullable(),
    person: z.object({ membershipId: z.uuid(), name: z.string() }).strict(),
    task: z.object({ id: z.uuid(), number: z.string(), title: z.string() }).strict(),
    project: z.object({ id: z.uuid(), number: z.string(), name: bilingual }).strict(),
    decidedByName: z.string().nullable(),
    /** What this person may do with the entry now. */
    actions: z.array(z.enum(['edit', 'delete', 'approve', 'reject', 'reopen'])),
    version: z.number().int(),
  })
  .strict();
export type TimeEntry = z.infer<typeof timeEntrySchema>;

export const timesheetSchema = z
  .object({
    /** Null while the week has no entries yet. */
    id: z.uuid().nullable(),
    weekStart: isoDate,
    weekEnd: isoDate,
    status: timesheetStatusSchema,
    submittedAt: z.iso.datetime().nullable(),
    entries: z.array(timeEntrySchema),
    /** Hours per date of the week (all 7 days, "0" when none). */
    days: z.array(z.object({ date: isoDate, hours: hoursSchema }).strict()),
    totalHours: hoursSchema,
    billableHours: hoursSchema,
    canSubmit: z.boolean(),
  })
  .strict();
export type Timesheet = z.infer<typeof timesheetSchema>;

export const weekQuerySchema = z.object({ week: isoDate.optional() }).strict();
export const timeEntryIdParamSchema = z.object({ id: z.uuid() }).strict();
export const timesheetIdParamSchema = z.object({ id: z.uuid() }).strict();

export const approvalListResponseSchema = z.object({ items: z.array(timeEntrySchema) }).strict();

export const timerSchema = z
  .object({
    running: z
      .object({
        task: z.object({ id: z.uuid(), number: z.string(), title: z.string() }).strict(),
        startedAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const timeSummaryQuerySchema = z
  .object({ from: isoDate, to: isoDate, membershipId: z.uuid().optional() })
  .strict()
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'before_from' })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, {
    path: ['to'],
    message: 'range_too_long',
  });

export const timeSummarySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    person: z.object({ membershipId: z.uuid(), name: z.string() }).strict(),
    logged: hoursSchema,
    approved: hoursSchema,
    billable: hoursSchema,
    nonBillable: hoursSchema,
    /** Billable share of approved hours, 0–100 (null when nothing is approved). */
    billablePercent: z.number().int().min(0).max(100).nullable(),
    days: z.array(z.object({ date: isoDate, hours: hoursSchema }).strict()),
    projects: z.array(
      z
        .object({
          id: z.uuid(),
          number: z.string(),
          name: bilingual,
          logged: hoursSchema,
          approved: hoursSchema,
          billable: hoursSchema,
        })
        .strict(),
    ),
  })
  .strict();

/** Planned vs actual for one task, per person. */
export const taskTimeSchema = z
  .object({
    items: z.array(
      z
        .object({
          membershipId: z.uuid(),
          name: z.string(),
          allocated: hoursSchema,
          logged: hoursSchema,
          approved: hoursSchema,
        })
        .strict(),
    ),
  })
  .strict();
