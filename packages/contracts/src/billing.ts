import { z } from 'zod';
import { moneySchema } from './agreements.js';

// Invoicing & payments (docs/modules/billing.md §6).

export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void'] as const;
export const PAYMENT_METHODS = [
  'bank_transfer',
  'cash',
  'cheque',
  'card',
  'knet',
  'other',
] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

const isoDate = z.iso.date();
const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();
const percent = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'percent');
const quantity = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'quantity');

export const billingSettingsSchema = z
  .object({
    paymentTermsDays: z.number().int().min(0).max(365),
    taxes: z
      .array(
        z
          .object({
            code: z.string().regex(/^[a-z][a-z0-9_]{1,19}$/),
            label: z.string().trim().min(1).max(80),
            ratePercent: percent,
            active: z.boolean(),
          })
          .strict(),
      )
      .max(10),
    /** Until a Kuwaiti accountant confirms the tax settings. */
    toVerify: z.boolean(),
  })
  .strict();
export type BillingSettings = z.infer<typeof billingSettingsSchema>;
export const billingSettingsUpdateSchema = billingSettingsSchema
  .omit({ toVerify: true })
  .partial()
  .extend({ confirmVerified: z.boolean().optional() })
  .strict();

export const invoiceLineInputSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity,
    unitPrice: moneySchema,
    discountPercent: percent.optional(),
    taxCode: z.string().max(20).nullable().optional(),
  })
  .strict();

const draftFields = {
  contractId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
  lines: z.array(invoiceLineInputSchema).max(200).optional(),
};
export const createInvoiceRequestSchema = z.object({ clientId: z.uuid(), ...draftFields }).strict();
export const updateInvoiceRequestSchema = z
  .object(draftFields)
  .extend({ version: z.number().int().positive() })
  .strict();
export const invoiceFromTimeRequestSchema = z
  .object({
    projectId: z.uuid(),
    from: isoDate,
    to: isoDate,
    hourlyRate: moneySchema,
    /** Also re-bill approved billable expenses of the project in the period, at cost. */
    includeExpenses: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'before_from' });
export const issueInvoiceRequestSchema = z
  .object({ issueDate: isoDate.optional(), dueDate: isoDate.optional() })
  .strict();
export const voidInvoiceRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export const paymentRequestSchema = z
  .object({
    amount: moneySchema,
    receivedOn: isoDate,
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(200).optional(),
  })
  .strict();
export const reversePaymentRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export const creditNoteRequestSchema = z
  .object({ amount: moneySchema, reason: z.string().trim().min(1).max(1000) })
  .strict();

export const invoiceLineSchema = z
  .object({
    id: z.uuid(),
    description: z.string(),
    quantity: z.string(),
    unitPrice: z.string(),
    discountPercent: z.string(),
    taxCode: z.string().nullable(),
    amount: z.string(),
    discount: z.string(),
    tax: z.string(),
  })
  .strict();

export const invoiceSummarySchema = z
  .object({
    id: z.uuid(),
    number: z.string().nullable(),
    client: z.object({ id: z.uuid(), number: z.string(), name: bilingual }).strict(),
    status: invoiceStatusSchema,
    overdue: z.boolean(),
    issueDate: isoDate.nullable(),
    dueDate: isoDate.nullable(),
    currency: z.string(),
    total: z.string(),
    outstanding: z.string(),
  })
  .strict();
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const invoiceSchema = invoiceSummarySchema
  .extend({
    contract: z.object({ id: z.uuid(), number: z.string() }).strict().nullable(),
    project: z.object({ id: z.uuid(), number: z.string(), name: bilingual }).strict().nullable(),
    subtotal: z.string(),
    discountTotal: z.string(),
    taxTotal: z.string(),
    paidTotal: z.string(),
    creditedTotal: z.string(),
    notes: z.string(),
    voidReason: z.string().nullable(),
    lines: z.array(invoiceLineSchema),
    timeEntries: z.number().int(),
    expenseLines: z.number().int(),
    payments: z.array(
      z
        .object({
          id: z.uuid(),
          amount: z.string(),
          receivedOn: isoDate,
          method: z.enum(PAYMENT_METHODS),
          reference: z.string(),
          source: z.enum(['recorded', 'provider']),
          status: z.enum(['recorded', 'reversed']),
          reverseReason: z.string().nullable(),
        })
        .strict(),
    ),
    creditNotes: z.array(
      z
        .object({
          id: z.uuid(),
          number: z.string(),
          amount: z.string(),
          reason: z.string(),
          issuedOn: isoDate,
        })
        .strict(),
    ),
    actions: z.array(z.enum(['edit', 'delete', 'issue', 'void', 'pay', 'credit'])),
    version: z.number().int(),
  })
  .strict();
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceListQuerySchema = z
  .object({
    status: invoiceStatusSchema.optional(),
    overdue: z.enum(['true', 'false']).optional(),
    clientId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
export const invoiceListResponseSchema = z
  .object({ items: z.array(invoiceSummarySchema) })
  .strict();
export const billingIdParamSchema = z.object({ id: z.uuid() }).strict();

export const agingSchema = z
  .object({
    currency: z.string(),
    buckets: z.array(
      z
        .object({
          key: z.enum(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']),
          amount: z.string(),
          count: z.number().int(),
        })
        .strict(),
    ),
    total: z.string(),
    clients: z.array(
      z
        .object({ id: z.uuid(), name: bilingual, outstanding: z.string(), overdue: z.string() })
        .strict(),
    ),
  })
  .strict();
export const revenueQuerySchema = z
  .object({ year: z.coerce.number().int().min(2000).max(2100) })
  .strict();
export const revenueSchema = z
  .object({
    year: z.number().int(),
    currency: z.string(),
    months: z.array(
      z.object({ month: z.string(), invoiced: z.string(), received: z.string() }).strict(),
    ),
    totals: z.object({ invoiced: z.string(), received: z.string() }).strict(),
  })
  .strict();
