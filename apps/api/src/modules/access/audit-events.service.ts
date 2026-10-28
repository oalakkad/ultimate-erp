import { HttpStatus, Injectable } from '@nestjs/common';
import { auditEvents } from '@ultimate-erp/db';
import { desc, lt } from 'drizzle-orm';
import { z } from 'zod';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { type AccessContext } from './access-context.js';

/**
 * Cursor = the last event ID seen. IDs are UUIDv7 (time-ordered, generated at insert), so
 * "newer first" is simply descending ID — exact, unlike timestamps rounded to milliseconds.
 */
const cursorSchema = z.uuid();

/** Read access to this company's audit trail, newest first (api.md §7 cursor pagination). */
@Injectable()
export class AuditEventsService {
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
        .from(auditEvents)
        .where(after?.data ? lt(auditEvents.id, after.data) : undefined)
        .orderBy(desc(auditEvents.id))
        .limit(limit + 1),
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        actorUserId: e.actorUserId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        requestId: e.requestId,
        details: e.details,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
