import { z } from 'zod';
import { fileSchema } from './files.js';

// Contracts & engagement letters (docs/modules/contracts.md §6). File named "agreements" to avoid
// confusion with this package ("contracts" = API contracts).

export const CONTRACT_KINDS = ['contract', 'engagement_letter'] as const;
export const CONTRACT_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'sent',
  'signed',
  'active',
  'expired',
  'terminated',
] as const;
export const CONTRACT_ACTIONS = [
  'edit',
  'submit',
  'approve',
  'reject',
  'send',
  'sign',
  'activate',
  'terminate',
] as const;

export const contractKindSchema = z.enum(CONTRACT_KINDS);
export const contractStatusSchema = z.enum(CONTRACT_STATUSES);
export type ContractKind = z.infer<typeof contractKindSchema>;
export type ContractStatus = z.infer<typeof contractStatusSchema>;
export type ContractAction = (typeof CONTRACT_ACTIONS)[number];

/** Money travels as a decimal string (never a float): up to 17 digits and 3 decimals (KWD). */
export const moneySchema = z.string().regex(/^\d{1,17}(\.\d{1,3})?$/, 'money');
const isoDate = z.iso.date();
const body = z.string().max(100_000);

// --- Templates ----------------------------------------------------------------------------------

/** Placeholders a template may use (shown to template authors). */
export const TEMPLATE_PLACEHOLDERS = [
  'client.name',
  'client.number',
  'document.number',
  'document.title',
  'start_date',
  'end_date',
  'value',
  'payment_terms',
  'company.name',
  'today',
] as const;
export type TemplateValues = Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string>>;

/**
 * Fills {{placeholder}} markers (spaces allowed inside the braces). Unknown or empty ones are left
 * visible so the author notices them; values are inserted as plain text, never as markup.
 */
export function renderTemplate(text: string, values: TemplateValues): string {
  return text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (marker, key: string) => {
    const value = values[key as keyof TemplateValues];
    return value === undefined || value === '' ? marker : value;
  });
}

export const templateRequestSchema = z
  .object({
    kind: contractKindSchema,
    name: z.string().trim().min(1).max(200),
    bodyEn: body.min(1),
    bodyAr: body.min(1),
  })
  .strict();
export const templateUpdateSchema = templateRequestSchema
  .omit({ kind: true })
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict();
export const templateSchema = z
  .object({
    id: z.uuid(),
    kind: contractKindSchema,
    name: z.string(),
    bodyEn: z.string(),
    bodyAr: z.string(),
    archived: z.boolean(),
    version: z.number().int(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ContractTemplate = z.infer<typeof templateSchema>;
export const templateListResponseSchema = z.object({ items: z.array(templateSchema) }).strict();

// --- Contracts ----------------------------------------------------------------------------------

const termsFields = {
  titleEn: z.string().trim().min(1).max(300),
  titleAr: z.string().trim().min(1).max(300),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  valueAmount: moneySchema.nullable().optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((v) => v.toUpperCase())
    .optional(),
  paymentTerms: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  renewalNoticeDays: z.number().int().min(0).max(365).optional(),
};

const datesOrdered = (v: {
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
}) => !v.startDate || !v.endDate || v.endDate >= v.startDate;

export const createContractRequestSchema = z
  .object({
    kind: contractKindSchema,
    clientId: z.uuid(),
    templateId: z.uuid().nullable().optional(),
    ...termsFields,
  })
  .strict()
  .refine(datesOrdered, { path: ['endDate'], message: 'before_start' });

export const updateContractRequestSchema = z
  .object(termsFields)
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict()
  .refine(datesOrdered, { path: ['endDate'], message: 'before_start' });

export const newVersionRequestSchema = z
  .object({ bodyEn: body, bodyAr: body, changeNote: z.string().trim().max(500).optional() })
  .strict();
export const rejectRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export const terminateRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
/** "Signed" = a counter-signed copy was uploaded (POST /files first). Not an e-signature. */
export const signRequestSchema = z
  .object({ fileId: z.uuid(), signedOn: isoDate.optional() })
  .strict();

const person = z.object({ name: z.string() }).strict().nullable();

export const contractSummarySchema = z
  .object({
    id: z.uuid(),
    kind: contractKindSchema,
    number: z.string(),
    title: z.object({ en: z.string(), ar: z.string() }).strict(),
    client: z
      .object({
        id: z.uuid(),
        number: z.string(),
        name: z.object({ en: z.string(), ar: z.string() }).strict(),
      })
      .strict(),
    status: contractStatusSchema,
    startDate: isoDate.nullable(),
    endDate: isoDate.nullable(),
    valueAmount: moneySchema.nullable(),
    currency: z.string(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ContractSummary = z.infer<typeof contractSummarySchema>;

export const contractSchema = contractSummarySchema
  .extend({
    paymentTerms: z.string().nullable(),
    renewalNoticeDays: z.number().int(),
    currentVersion: z.number().int(),
    submittedBy: person,
    approvedBy: person,
    approvedAt: z.iso.datetime().nullable(),
    reviewNote: z.string().nullable(),
    sentAt: z.iso.datetime().nullable(),
    signedAt: z.iso.datetime().nullable(),
    signedFile: fileSchema.nullable(),
    activatedAt: z.iso.datetime().nullable(),
    terminatedAt: z.iso.datetime().nullable(),
    terminationReason: z.string().nullable(),
    /** What the signed-in person may do next (UX only — the server re-checks every action). */
    actions: z.array(z.enum(CONTRACT_ACTIONS)),
    version: z.number().int(),
  })
  .strict();
export type Contract = z.infer<typeof contractSchema>;

export const contractVersionSchema = z
  .object({
    versionNo: z.number().int(),
    bodyEn: z.string(),
    bodyAr: z.string(),
    changeNote: z.string().nullable(),
    authorName: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const contractVersionListResponseSchema = z
  .object({ items: z.array(contractVersionSchema) })
  .strict();

export const contractListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: contractStatusSchema.optional(),
    kind: contractKindSchema.optional(),
    clientId: z.uuid().optional(),
    expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export const contractListResponseSchema = z
  .object({ items: z.array(contractSummarySchema), nextCursor: z.string().nullable() })
  .strict();
export const contractIdParamSchema = z.object({ id: z.uuid() }).strict();
