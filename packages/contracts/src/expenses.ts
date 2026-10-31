import { z } from 'zod';
import { moneySchema } from './agreements.js';

// Expenses (docs/modules/expenses.md §6).

export const EXPENSE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
] as const;
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;
export const REIMBURSEMENT_METHODS = ['bank_transfer', 'cash', 'cheque', 'other'] as const;

const isoDate = z.iso.date();
const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();
const categoryCode = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/);

export const expenseSettingsSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            code: categoryCode,
            nameEn: z.string().trim().min(1).max(80),
            nameAr: z.string().trim().min(1).max(80),
            active: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    /** Lines above this amount need a receipt before the claim can be submitted. */
    receiptRequiredAbove: moneySchema,
  })
  .strict();
export type ExpenseSettings = z.infer<typeof expenseSettingsSchema>;

export const expenseLineInputSchema = z
  .object({
    spentOn: isoDate,
    category: categoryCode,
    description: z.string().trim().min(1).max(500),
    amount: moneySchema,
    projectId: z.uuid().nullable().optional(),
    billable: z.boolean().optional(),
    /** A file I uploaded (POST /files first). */
    receiptFileId: z.uuid().nullable().optional(),
  })
  .strict();

export const createExpenseRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    lines: z.array(expenseLineInputSchema).max(50).optional(),
  })
  .strict();
export const updateExpenseRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    lines: z.array(expenseLineInputSchema).max(50).optional(),
    version: z.number().int().positive(),
  })
  .strict();
export const expenseDecisionSchema = z
  .object({ note: z.string().trim().max(1000).optional() })
  .strict();
export const expenseRejectSchema = z.object({ note: z.string().trim().min(1).max(1000) }).strict();
export const expenseReimburseSchema = z
  .object({
    reimbursedOn: isoDate,
    method: z.enum(REIMBURSEMENT_METHODS),
    reference: z.string().trim().max(200).optional(),
  })
  .strict();

export const expenseLineSchema = z
  .object({
    id: z.uuid(),
    spentOn: isoDate,
    category: z.object({ code: z.string(), name: bilingual }).strict(),
    description: z.string(),
    amount: z.string(),
    project: z.object({ id: z.uuid(), number: z.string(), name: bilingual }).strict().nullable(),
    billable: z.boolean(),
    receipt: z.object({ id: z.uuid(), name: z.string(), status: z.string() }).strict().nullable(),
    /** Number of the invoice it was re-billed on, if any (not void). */
    invoiceNumber: z.string().nullable(),
    invoiced: z.boolean(),
  })
  .strict();

export const expenseSummarySchema = z
  .object({
    id: z.uuid(),
    number: z.string().nullable(),
    title: z.string(),
    person: z.object({ membershipId: z.uuid(), name: z.string() }).strict(),
    status: expenseStatusSchema,
    currency: z.string(),
    total: z.string(),
    lineCount: z.number().int(),
    submittedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;

export const expenseClaimSchema = expenseSummarySchema
  .extend({
    lines: z.array(expenseLineSchema),
    decidedByName: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    decisionNote: z.string().nullable(),
    reimbursement: z
      .object({
        reimbursedOn: isoDate,
        method: z.enum(REIMBURSEMENT_METHODS),
        reference: z.string(),
        byName: z.string().nullable(),
      })
      .strict()
      .nullable(),
    actions: z.array(
      z.enum(['edit', 'delete', 'submit', 'approve', 'reject', 'reopen', 'reimburse']),
    ),
    version: z.number().int(),
  })
  .strict();
export type ExpenseClaim = z.infer<typeof expenseClaimSchema>;

export const expenseListQuerySchema = z
  .object({
    view: z.enum(['mine', 'approvals', 'reimburse', 'all']).default('mine'),
    status: expenseStatusSchema.optional(),
  })
  .strict();
export const expenseListResponseSchema = z
  .object({ items: z.array(expenseSummarySchema) })
  .strict();
export const expenseIdParamSchema = z.object({ id: z.uuid() }).strict();
export const expenseLineParamSchema = z.object({ id: z.uuid(), lineId: z.uuid() }).strict();

/** A project's expense cost (approved and reimbursed claims). */
export const projectExpensesSchema = z
  .object({
    approved: z.string(),
    billable: z.string(),
    invoiced: z.string(),
    pending: z.string(),
    lines: z.array(
      z
        .object({
          id: z.uuid(),
          claimId: z.uuid(),
          claimNumber: z.string().nullable(),
          spentOn: isoDate,
          person: z.string(),
          category: bilingual,
          description: z.string(),
          amount: z.string(),
          billable: z.boolean(),
          invoiced: z.boolean(),
          status: expenseStatusSchema,
        })
        .strict(),
    ),
  })
  .strict();
