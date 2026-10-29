import { z } from 'zod';

// In-app notifications (docs/modules/platform-jobs.md §5). Each module adds its own types.

export const NOTIFICATION_TYPES = ['access.member_joined', 'access.roles_changed'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Most recipients one `notify` call may address (protection against accidental mass sends). */
export const NOTIFICATION_RECIPIENT_LIMIT = 200;

export const notificationSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(NOTIFICATION_TYPES),
    /** Display values for the message (names, role keys), never confidential data. */
    params: z.record(z.string(), z.string()),
    /** Relative path in this company's app; opening it re-checks access. */
    link: z.string().nullable(),
    read: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export const notificationListResponseSchema = z
  .object({ items: z.array(notificationSchema), nextCursor: z.string().nullable() })
  .strict();
export const unreadCountResponseSchema = z.object({ count: z.number().int().min(0) }).strict();
export const notificationIdParamSchema = z.object({ id: z.uuid() }).strict();
