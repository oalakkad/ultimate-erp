import { z } from 'zod';
import { fileSchema } from './files.js';

// Clients / CRM (docs/modules/clients.md §5). Shared by the API (validation) and the web app (forms).

export const CLIENT_TYPES = ['company', 'individual', 'government'] as const;
export const CLIENT_STATUSES = ['prospect', 'active', 'inactive'] as const;
export const INTERACTION_KINDS = ['note', 'call', 'meeting', 'email'] as const;

export const clientTypeSchema = z.enum(CLIENT_TYPES);
export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

/** Optional text from a form: trimmed; empty means "not set" (stored as null). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalEmail = z
  .union([z.literal(''), z.email().max(254).toLowerCase()])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const optionalPhone = z
  .string()
  .trim()
  .regex(/^$|^\+?[0-9 ()-]{6,20}$/, 'phone')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const clientFields = {
  type: clientTypeSchema.optional(),
  legalNameEn: requiredText(200),
  legalNameAr: requiredText(200),
  /** Kuwait commercial registration number (or another country's registry number). */
  commercialRegistration: z
    .string()
    .trim()
    .regex(/^$|^[A-Za-z0-9-]{1,30}$/, 'commercialRegistration')
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable()
    .optional(),
  industry: optionalText(100),
  email: optionalEmail,
  phone: optionalPhone,
  website: z
    .union([z.literal(''), z.url({ protocol: /^https?$/ }).max(300)])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  addressLine: optionalText(300),
  city: optionalText(100),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .optional(),
  status: clientStatusSchema.optional(),
  accountManagerMembershipId: z.uuid().nullable().optional(),
};

export const createClientRequestSchema = z
  .object({
    ...clientFields,
    /** Set after the user has seen and accepted a "possible duplicate" warning. */
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();

export const updateClientRequestSchema = z
  .object(clientFields)
  .partial()
  .extend({
    /** Optimistic concurrency: the version the edit was based on (api.md §8). */
    version: z.number().int().positive(),
  })
  .strict();

const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();

export const clientSummarySchema = z
  .object({
    id: z.uuid(),
    number: z.string(),
    legalName: bilingual,
    type: clientTypeSchema,
    status: clientStatusSchema,
    archived: z.boolean(),
    commercialRegistration: z.string().nullable(),
    city: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ClientSummary = z.infer<typeof clientSummarySchema>;

export const clientSchema = clientSummarySchema
  .extend({
    industry: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    addressLine: z.string().nullable(),
    country: z.string(),
    accountManager: z.object({ membershipId: z.uuid(), name: z.string() }).strict().nullable(),
    version: z.number().int(),
  })
  .strict();
export type Client = z.infer<typeof clientSchema>;

/** "name" sorts by the English legal name, "nameAr" by the Arabic one. */
export const CLIENT_SORTS = ['name', 'nameAr', 'created', 'updated', 'number'] as const;

export const clientListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: clientStatusSchema.optional(),
    archived: z.enum(['true', 'false']).default('false'),
    sort: z.enum(CLIENT_SORTS).default('name'),
    dir: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(500).optional(),
  })
  .strict();
export type ClientListQuery = z.input<typeof clientListQuerySchema>;

export const clientListResponseSchema = z
  .object({ items: z.array(clientSummarySchema), nextCursor: z.string().nullable() })
  .strict();

export const clientIdParamSchema = z.object({ id: z.uuid() }).strict();
export const clientChildParamSchema = z.object({ id: z.uuid(), childId: z.uuid() }).strict();

/**
 * Legal-form words that do not make two names different (EN + AR, Kuwait/GCC usage). Written in
 * normalised form (as clientNameKey produces them: ؤ → و, ة → ه).
 */
const LEGAL_FORMS = new Set([
  'wll',
  'kscc',
  'kscp',
  'ksc',
  'kpsc',
  'spc',
  'llc',
  'ltd',
  'limited',
  'co',
  'company',
  'corp',
  'inc',
  'est',
  'establishment',
  'group',
  'the',
  'شركه',
  'ذمم',
  'شمك',
  'شمكم',
  'شمكع',
  'مقفله',
  'عامه',
  'موسسه',
  'مجموعه',
  'ال',
]);

/**
 * Key used to warn about duplicate clients: lower-case, accents and Arabic diacritics removed,
 * Arabic letter variants unified, punctuation dropped, legal-form words (W.L.L., K.S.C.,
 * ش.م.ك …) ignored. "Al-Noor Trading Co. W.L.L." and "al noor trading" get the same key.
 */
export function clientNameKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\.(?=\S)/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !LEGAL_FORMS.has(w));
  return words.join(' ');
}

/** Body of the 409 when the name matches an existing client (details carry their numbers). */
export const POSSIBLE_DUPLICATE = 'possible_duplicate';

// --- Contacts ------------------------------------------------------------------------------

export const contactRequestSchema = z
  .object({
    name: requiredText(200),
    position: optionalText(100),
    email: optionalEmail,
    phone: optionalPhone,
    isPrimary: z.boolean().optional(),
    isAuthorizedRepresentative: z.boolean().optional(),
  })
  .strict();
export const contactUpdateSchema = contactRequestSchema.partial().strict();

export const contactSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    position: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    isPrimary: z.boolean(),
    isAuthorizedRepresentative: z.boolean(),
    archived: z.boolean(),
  })
  .strict();
export type Contact = z.infer<typeof contactSchema>;
export const contactListResponseSchema = z.object({ items: z.array(contactSchema) }).strict();

// --- Communication history --------------------------------------------------------------------

export const interactionRequestSchema = z
  .object({
    kind: z.enum(INTERACTION_KINDS),
    occurredAt: z.iso.datetime({ offset: true }),
    summary: requiredText(4000),
    contactId: z.uuid().nullable().optional(),
  })
  .strict();

export const interactionSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(INTERACTION_KINDS),
    occurredAt: z.iso.datetime(),
    summary: z.string(),
    contact: z.object({ id: z.uuid(), name: z.string() }).strict().nullable(),
    authorName: z.string().nullable(),
  })
  .strict();
export type Interaction = z.infer<typeof interactionSchema>;
export const interactionListResponseSchema = z
  .object({ items: z.array(interactionSchema) })
  .strict();

// --- Documents ------------------------------------------------------------------------------

export const attachDocumentRequestSchema = z.object({ fileId: z.uuid() }).strict();
export const clientDocumentSchema = z
  .object({ file: fileSchema, addedAt: z.iso.datetime(), addedByName: z.string().nullable() })
  .strict();
export const clientDocumentListResponseSchema = z
  .object({ items: z.array(clientDocumentSchema) })
  .strict();

// --- Activity timeline ------------------------------------------------------------------------

export const CLIENT_ACTIVITY_ACTIONS = [
  'clients.client.created',
  'clients.client.updated',
  'clients.client.archived',
  'clients.client.restored',
  'clients.contact.added',
  'clients.contact.updated',
  'clients.contact.archived',
  'clients.interaction.logged',
  'clients.document.attached',
  'clients.document.detached',
] as const;

export const clientActivitySchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.uuid(),
          action: z.enum(CLIENT_ACTIVITY_ACTIONS),
          occurredAt: z.iso.datetime(),
          actorName: z.string().nullable(),
          /** Which fields changed (names only, never values), for "updated" entries. */
          fields: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();
