import { z } from 'zod';
import { EMPTY_UPDATE, hasAnyField } from './update.js';

// Leave management (docs/modules/leave.md §7).

export const LEAVE_ACCRUALS = ['none', 'monthly', 'yearly'] as const;
export const LEAVE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;
export const HALF_DAYS = ['none', 'first', 'second'] as const;
export const leaveStatusSchema = z.enum(LEAVE_STATUSES);
export type LeaveStatus = z.infer<typeof leaveStatusSchema>;

const isoDate = z.iso.date();
const daysSchema = z.string().regex(/^-?\d{1,3}(\.\d{1,2})?$/, 'days');
const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();
const text = (max: number) => z.string().trim().max(max);

const typeFields = {
  nameEn: text(120).min(1),
  nameAr: text(120).min(1),
  paid: z.boolean(),
  deductsBalance: z.boolean(),
  annualDays: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'days'),
  accrual: z.enum(LEAVE_ACCRUALS),
  allowHalfDay: z.boolean(),
  requiresDocument: z.boolean(),
  allowNegative: z.boolean(),
};
export const leaveTypeRequestSchema = z
  .object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), ...typeFields })
  .strict();
export const leaveTypeUpdateSchema = z
  .object({ ...typeFields, archived: z.boolean(), confirmVerified: z.boolean() })
  .partial()
  .strict()
  .refine(hasAnyField, EMPTY_UPDATE);

export const leaveTypeSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: bilingual,
    paid: z.boolean(),
    deductsBalance: z.boolean(),
    annualDays: z.string(),
    accrual: z.enum(LEAVE_ACCRUALS),
    allowHalfDay: z.boolean(),
    requiresDocument: z.boolean(),
    allowNegative: z.boolean(),
    /** Pre-filled values not yet confirmed by a Kuwaiti lawyer/accountant. */
    toVerify: z.boolean(),
    archived: z.boolean(),
  })
  .strict();
export type LeaveType = z.infer<typeof leaveTypeSchema>;
export const leaveTypeListResponseSchema = z.object({ items: z.array(leaveTypeSchema) }).strict();

export const holidaySchema = z
  .object({ date: isoDate, nameEn: text(120).min(1), nameAr: text(120).min(1) })
  .strict();
export const holidaysRequestSchema = z
  .object({ year: z.number().int().min(2000).max(2100), holidays: z.array(holidaySchema).max(60) })
  .strict();
export const holidayListResponseSchema = z.object({ items: z.array(holidaySchema) }).strict();
export const holidayQuerySchema = z
  .object({ year: z.coerce.number().int().min(2000).max(2100) })
  .strict();

export const leaveApplicationSchema = z
  .object({
    leaveTypeId: z.uuid(),
    startDate: isoDate,
    endDate: isoDate,
    halfDay: z.enum(HALF_DAYS).optional(),
    reason: text(2000).optional(),
    fileId: z.uuid().nullable().optional(),
    /** Only compute days and balance; save nothing. */
    preview: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'before_start' })
  .refine((v) => !v.halfDay || v.halfDay === 'none' || v.startDate === v.endDate, {
    path: ['halfDay'],
    message: 'single_day_only',
  });

export const leaveDecisionSchema = z.object({ note: text(1000).optional() }).strict();
export const leaveReasonSchema = z.object({ note: text(1000).min(1) }).strict();

const personRef = z.object({ membershipId: z.uuid(), name: z.string() }).strict();

export const leaveRequestSchema = z
  .object({
    id: z.uuid(),
    person: personRef,
    type: z.object({ id: z.uuid(), code: z.string(), name: bilingual }).strict(),
    startDate: isoDate,
    endDate: isoDate,
    halfDay: z.enum(HALF_DAYS),
    days: z.string(),
    reason: z.string(),
    hasDocument: z.boolean(),
    status: leaveStatusSchema,
    decidedByName: z.string().nullable(),
    decisionNote: z.string().nullable(),
    createdAt: z.iso.datetime(),
    actions: z.array(z.enum(['approve', 'reject', 'withdraw', 'cancel'])),
  })
  .strict();
export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const leavePreviewSchema = z
  .object({
    days: z.string(),
    balanceBefore: z.string().nullable(),
    balanceAfter: z.string().nullable(),
    /** Problems that would stop the application (codes). */
    problems: z.array(
      z.enum([
        'insufficient_balance',
        'overlap',
        'no_working_days',
        'document_required',
        'half_day_not_allowed',
      ]),
    ),
  })
  .strict();

export const leaveListQuerySchema = z
  .object({
    view: z.enum(['mine', 'approvals', 'person']).default('mine'),
    membershipId: z.uuid().optional(),
    status: leaveStatusSchema.optional(),
  })
  .strict();
export const leaveListResponseSchema = z.object({ items: z.array(leaveRequestSchema) }).strict();
export const leaveIdParamSchema = z.object({ id: z.uuid() }).strict();

export const leaveBalanceQuerySchema = z
  .object({
    membershipId: z.uuid().optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();
export const leaveBalanceSchema = z
  .object({
    year: z.number().int(),
    person: personRef,
    items: z.array(
      z
        .object({
          type: z
            .object({ id: z.uuid(), code: z.string(), name: bilingual, toVerify: z.boolean() })
            .strict(),
          deductsBalance: z.boolean(),
          accrued: z.string(),
          adjustments: z.string(),
          taken: z.string(),
          pending: z.string(),
          balance: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const leaveAdjustmentRequestSchema = z
  .object({
    membershipId: z.uuid(),
    leaveTypeId: z.uuid(),
    year: z.number().int().min(2000).max(2100),
    days: daysSchema,
    note: text(500).min(1),
  })
  .strict();

export const leaveCalendarQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((q) => q.to >= q.from && Date.parse(q.to) - Date.parse(q.from) <= 92 * 86_400_000, {
    path: ['to'],
    message: 'range',
  });
export const leaveCalendarSchema = z
  .object({
    leave: z.array(
      z
        .object({
          id: z.uuid(),
          person: personRef,
          type: bilingual,
          startDate: isoDate,
          endDate: isoDate,
          halfDay: z.enum(HALF_DAYS),
          status: z.enum(['pending', 'approved']),
        })
        .strict(),
    ),
    holidays: z.array(holidaySchema),
  })
  .strict();
