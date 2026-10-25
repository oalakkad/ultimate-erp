import { z } from 'zod';

export const localeSchema = z.enum(['en', 'ar']);
export type Locale = z.infer<typeof localeSchema>;

/**
 * `GET /api/v1/tenant` — public profile of the company that owns the request host.
 * Shown before login (company name, language); contains no business data.
 */
export const tenantPublicProfileSchema = z
  .object({
    slug: z.string(),
    name: z.object({ en: z.string(), ar: z.string() }).strict(),
    defaultLocale: localeSchema,
  })
  .strict();
export type TenantPublicProfile = z.infer<typeof tenantPublicProfileSchema>;
