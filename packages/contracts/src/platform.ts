import { z } from 'zod';
import { localeSchema } from './tenancy.js';

// Platform console (docs/modules/platform.md §5): the installation's founder sees every company
// using the ERP — identity, size and activity — never a company's business data.

export const PLATFORM_COMPANY_STATUSES = ['active', 'suspended'] as const;
export const platformCompanyStatusSchema = z.enum(PLATFORM_COMPANY_STATUSES);

/** Whether the signed-in person may open the console (shown as a link, enforced on the server). */
export const platformMeResponseSchema = z.object({ founder: z.boolean() }).strict();

export const platformOverviewSchema = z
  .object({
    companies: z.number().int().min(0),
    companiesActive: z.number().int().min(0),
    companiesSuspended: z.number().int().min(0),
    companiesNew30d: z.number().int().min(0),
    people: z.number().int().min(0),
    accounts: z.number().int().min(0),
    signIns7d: z.number().int().min(0),
    /** Stored files across the installation, in bytes (as a string: may exceed 2^53 one day). */
    filesBytes: z.string().regex(/^\d+$/),
  })
  .strict();
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

export const platformCompanySchema = z
  .object({
    tenantId: z.uuid(),
    slug: z.string(),
    name: z.object({ en: z.string(), ar: z.string() }).strict(),
    status: platformCompanyStatusSchema,
    defaultLocale: localeSchema,
    createdAt: z.iso.datetime(),
    url: z.string().nullable(),
    activeMembers: z.number().int().min(0),
    pendingInvitations: z.number().int().min(0),
    owners: z.array(z.object({ name: z.string(), email: z.string() }).strict()),
    lastActivityAt: z.iso.datetime().nullable(),
    filesBytes: z.string().regex(/^\d+$/),
  })
  .strict();
export type PlatformCompany = z.infer<typeof platformCompanySchema>;

export const platformCompanyListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: platformCompanyStatusSchema.optional(),
  })
  .strict();
export const platformCompanyListResponseSchema = z
  .object({ items: z.array(platformCompanySchema) })
  .strict();

export const platformCompanyIdParamSchema = z.object({ id: z.uuid() }).strict();

/** Suspending needs a reason (kept in the platform audit, shown nowhere else). */
export const platformCompanyStatusRequestSchema = z
  .object({ status: platformCompanyStatusSchema, reason: z.string().trim().min(1).max(1000) })
  .strict();

export const PLATFORM_AUDIT_ACTIONS = [
  'platform.company.suspended',
  'platform.company.reactivated',
] as const;
export const platformAuditEventSchema = z
  .object({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    actorName: z.string().nullable(),
    action: z.enum(PLATFORM_AUDIT_ACTIONS),
    company: z.object({ tenantId: z.uuid(), slug: z.string() }).strict().nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .strict();
export const platformAuditListResponseSchema = z
  .object({ items: z.array(platformAuditEventSchema) })
  .strict();
