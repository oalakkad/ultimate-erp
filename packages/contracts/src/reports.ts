import { z } from 'zod';

// Reports & audit search (docs/modules/reports.md §4).

export const REPORT_KEYS = [
  'clients',
  'projects',
  'profitability',
  'utilization',
  'tasks',
  'timesheets',
  'attendance',
  'leave',
  'payroll',
  'invoices',
  'payments',
  'receivables',
  'revenue',
] as const;
export const reportKeySchema = z.enum(REPORT_KEYS);
export type ReportKey = z.infer<typeof reportKeySchema>;

/** How a column's string values are shown (formatting happens in the reader's language). */
export const REPORT_COLUMN_TYPES = [
  'text',
  'date',
  'money',
  'hours',
  'number',
  'percent',
  'status',
] as const;

const isoDate = z.iso.date();

export const reportCatalogSchema = z
  .object({
    items: z.array(
      z
        .object({
          key: reportKeySchema,
          /** Filters this report understands. */
          filters: z.array(z.enum(['period', 'client', 'project'])),
          /** Rows limited to the person's team / projects (not the whole company). */
          scoped: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

export const reportQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    clientId: z.uuid().optional(),
    projectId: z.uuid().optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.to >= q.from, { path: ['to'], message: 'before_from' });
export const reportKeyParamSchema = z.object({ key: reportKeySchema }).strict();

export const reportSchema = z
  .object({
    key: reportKeySchema,
    from: isoDate,
    to: isoDate,
    columns: z.array(z.object({ key: z.string(), type: z.enum(REPORT_COLUMN_TYPES) }).strict()),
    rows: z.array(z.record(z.string(), z.string().nullable())),
    /** Column totals where adding up makes sense (money, hours, counts). */
    totals: z.record(z.string(), z.string()).nullable(),
    /** True when more rows existed than the 2 000 shown. */
    truncated: z.boolean(),
    scoped: z.boolean(),
    generatedAt: z.iso.datetime(),
  })
  .strict();
export type Report = z.infer<typeof reportSchema>;

/** Audit search (Module N). */
export const auditSearchQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
    /** Prefix of the action, e.g. "billing." or "access.member". */
    action: z
      .string()
      .trim()
      .max(80)
      .regex(/^[a-z_.]*$/)
      .optional(),
    actorUserId: z.uuid().optional(),
    targetType: z
      .string()
      .trim()
      .max(60)
      .regex(/^[a-z_]*$/)
      .optional(),
    targetId: z.uuid().optional(),
    requestId: z.string().trim().max(100).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();
