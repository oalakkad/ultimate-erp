import { HttpStatus, Injectable } from '@nestjs/common';
import {
  MANDATORY_IN_APP,
  type Notification,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '@ultimate-erp/contracts';
import { notificationPreferences, notifications } from '@ultimate-erp/db';
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { type AccessContext } from '../access/access-context.js';

/** UUIDv7 IDs sort by creation time, so "older than the cursor" is `id < cursor`. */
const cursorSchema = z.uuid();
const isKnownType = (type: string): type is NotificationType =>
  (NOTIFICATION_TYPES as readonly string[]).includes(type);

/**
 * My own notifications in this company. Row-level security limits every query to the company;
 * every query here also limits it to the signed-in person (another member's ID ⇒ 404).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly database: TenantDatabase) {}

  async list(access: AccessContext, limit: number, cursor?: string) {
    const after = cursor === undefined ? undefined : cursorSchema.safeParse(cursor);
    if (after && !after.success) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, 'Invalid cursor.', [
        { path: 'cursor', code: 'invalid' },
      ]);
    }
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, access.userId),
            after?.data ? lt(notifications.id, after.data) : undefined,
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(limit + 1),
    );
    const page = rows.slice(0, limit);
    const items: Notification[] = page.flatMap((row) =>
      // A type removed in a later version is skipped rather than breaking the list.
      isKnownType(row.type)
        ? [
            {
              id: row.id,
              type: row.type,
              params: row.params,
              link: row.link,
              read: row.readAt !== null,
              createdAt: row.createdAt.toISOString(),
            },
          ]
        : [],
    );
    return { items, nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
  }

  async unreadCount(access: AccessContext) {
    const [row] = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select({ count: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, access.userId), isNull(notifications.readAt))),
    );
    return { count: row?.count ?? 0 };
  }

  async markRead(access: AccessContext, id: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      const [found] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, access.userId)));
      if (!found) throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
      await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
    });
  }

  async markAllRead(access: AccessContext) {
    await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, access.userId), isNull(notifications.readAt))),
    );
  }

  /** Every type with my choice (defaults: in the app, no email). */
  async preferences(access: AccessContext) {
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.membershipId, access.membershipId)),
    );
    const mine = new Map(rows.map((r) => [r.type, r]));
    return {
      items: NOTIFICATION_TYPES.map((type) => {
        const mandatory = MANDATORY_IN_APP.includes(type);
        return {
          type,
          inApp: mandatory || (mine.get(type)?.inApp ?? true),
          email: mine.get(type)?.email ?? false,
          mandatory,
        };
      }),
    };
  }

  async setPreferences(
    access: AccessContext,
    items: { type: NotificationType; inApp: boolean; email: boolean }[],
  ) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      for (const item of items) {
        const inApp = MANDATORY_IN_APP.includes(item.type) ? true : item.inApp;
        await tx
          .insert(notificationPreferences)
          .values({
            tenantId: access.tenantId,
            membershipId: access.membershipId,
            type: item.type,
            inApp,
            email: item.email,
          })
          .onConflictDoUpdate({
            target: [
              notificationPreferences.tenantId,
              notificationPreferences.membershipId,
              notificationPreferences.type,
            ],
            set: { inApp, email: item.email, updatedAt: new Date() },
          });
      }
    });
    return this.preferences(access);
  }
}
