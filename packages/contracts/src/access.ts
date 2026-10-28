import { z } from 'zod';
import { roleSchema } from './permissions.js';
import { localeSchema } from './tenancy.js';

// Request/response shapes for the access module (docs/modules/access.md §5).

/** Subdomain labels we keep for the platform itself. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'app',
  'admin',
  'auth',
  'login',
  'account',
  'accounts',
  'mail',
  'email',
  'smtp',
  'static',
  'assets',
  'cdn',
  'docs',
  'help',
  'support',
  'status',
  'billing',
  'platform',
  'system',
  'root',
  'dev',
  'staging',
  'test',
  'demo',
  'localhost',
  'ultimate',
  'erp',
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'must be 3–40 letters, digits or hyphens')
  .refine((slug) => !RESERVED_SLUGS.has(slug), 'is reserved');

export const createCompanyRequestSchema = z
  .object({
    slug: slugSchema,
    nameEn: z.string().trim().min(2).max(120),
    nameAr: z.string().trim().min(2).max(120),
    defaultLocale: localeSchema.default('en'),
  })
  .strict();

export const createCompanyResponseSchema = z
  .object({
    tenantId: z.uuid(),
    slug: z.string(),
    url: z.string(),
    twoFactorRequired: z.boolean(),
  })
  .strict();

export const memberSchema = z
  .object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.string(),
    status: z.enum(['invited', 'active', 'suspended', 'removed']),
    roles: z.array(roleSchema),
    joinedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const memberListResponseSchema = z.object({ members: z.array(memberSchema) }).strict();

export const membershipIdParamSchema = z.object({ id: z.uuid() }).strict();

export const setRolesRequestSchema = z
  .object({ roles: z.array(roleSchema).min(1).max(8) })
  .strict();

export const createInvitationRequestSchema = z
  .object({ email: z.email().max(254).toLowerCase(), role: roleSchema })
  .strict();

export const invitationSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    role: roleSchema,
    status: z.enum(['pending', 'accepted', 'revoked']),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const invitationListResponseSchema = z
  .object({ invitations: z.array(invitationSchema) })
  .strict();

export const invitationTokenQuerySchema = z.object({ token: z.string().min(1).max(512) }).strict();
export const acceptInvitationRequestSchema = z
  .object({ token: z.string().min(1).max(512) })
  .strict();

/** What an invitee sees before accepting. The address is masked (a link can be forwarded). */
export const invitationPreviewResponseSchema = z
  .object({
    company: z.object({ en: z.string(), ar: z.string() }).strict(),
    role: roleSchema,
    emailHint: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const auditEventSchema = z
  .object({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    actorUserId: z.uuid().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.uuid().nullable(),
    requestId: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .strict();

export const auditListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export const auditListResponseSchema = z
  .object({ items: z.array(auditEventSchema), nextCursor: z.string().nullable() })
  .strict();
