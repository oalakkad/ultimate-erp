import { z } from 'zod';
import { roleSchema } from './permissions.js';

// Company announcements (docs/modules/notifications.md §4).

const text = (max: number) => z.string().trim().min(1).max(max);
const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();

const announcementFields = {
  titleEn: text(200),
  titleAr: text(200),
  bodyEn: text(8000),
  bodyAr: text(8000),
  /** Empty = everyone in the company. */
  roles: z.array(roleSchema).max(10),
  /** Also send an email copy (in each person's language). */
  email: z.boolean(),
};
export const announcementPreviewRequestSchema = z
  .object({ roles: z.array(roleSchema).max(10) })
  .strict();
export const announcementPreviewSchema = z.object({ recipients: z.number().int().min(0) }).strict();
export const publishAnnouncementRequestSchema = z
  .object({
    ...announcementFields,
    /** Must equal the preview count: protects against sending to more people than intended. */
    confirmRecipients: z.number().int().min(1),
  })
  .strict();

export const announcementSchema = z
  .object({
    id: z.uuid(),
    title: bilingual,
    body: bilingual,
    roles: z.array(roleSchema),
    email: z.boolean(),
    recipients: z.number().int(),
    publishedByName: z.string().nullable(),
    publishedAt: z.iso.datetime(),
    /** Email delivery counts — only for people who may publish. */
    delivery: z
      .object({ queued: z.number().int(), sent: z.number().int(), failed: z.number().int() })
      .strict()
      .nullable(),
  })
  .strict();
export type Announcement = z.infer<typeof announcementSchema>;
export const announcementListResponseSchema = z
  .object({ items: z.array(announcementSchema) })
  .strict();
export const announcementIdParamSchema = z.object({ id: z.uuid() }).strict();
