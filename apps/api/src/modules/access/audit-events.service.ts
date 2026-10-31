import { HttpStatus, Injectable } from '@nestjs/common';
import { type auditSearchQuerySchema } from '@ultimate-erp/contracts';
import { auditEvents, type TenantTransaction } from '@ultimate-erp/db';
import { and, desc, eq, gte, like, lt, type SQL } from 'drizzle-orm';
import { type Request } from 'express';
import { z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { csvCell } from '../clients/clients.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { type AccessContext } from './access-context.js';

/**
 * Cursor = the last event ID seen. IDs are UUIDv7 (time-ordered, generated at insert), so
 * "newer first" is simply descending ID — exact, unlike timestamps rounded to milliseconds.
 */
const cursorSchema = z.uuid();
const EXPORT_LIMIT = 5000;
type Search = z.output<typeof auditSearchQuerySchema>;

/** Kuwait is UTC+3 all year: a Kuwait date's day runs from 21:00 UTC the day before. */
const kuwaitDayStart = (iso: string) => new Date(Date.parse(`${iso}T00:00:00+03:00`));

/** Read access to this company's audit trail, newest first, with filters (reports.md §2). */
@Injectable()
export class AuditEventsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly identity: IdentityService,
    private readonly audit: AuditLog,
  ) {}

  private conditions(query: Omit<Search, 'limit' | 'cursor'>): (SQL | undefined)[] {
    const escaped = query.action?.replace(/[\\%_]/g, (c) => `\\${c}`);
    return [
      escaped ? like(auditEvents.action, `${escaped}%`) : undefined,
      query.actorUserId ? eq(auditEvents.actorUserId, query.actorUserId) : undefined,
      query.targetType ? eq(auditEvents.targetType, query.targetType) : undefined,
      query.targetId ? eq(auditEvents.targetId, query.targetId) : undefined,
      query.requestId ? eq(auditEvents.requestId, query.requestId) : undefined,
      query.from ? gte(auditEvents.occurredAt, kuwaitDayStart(query.from)) : undefined,
      query.to
        ? lt(auditEvents.occurredAt, new Date(kuwaitDayStart(query.to).getTime() + 86_400_000))
        : undefined,
    ];
  }

  private async rows(tx: TenantTransaction, where: (SQL | undefined)[], limit: number) {
    return tx
      .select()
      .from(auditEvents)
      .where(and(...where))
      .orderBy(desc(auditEvents.id))
      .limit(limit);
  }

  private async withNames(rows: (typeof auditEvents.$inferSelect)[]) {
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const names = new Map((await this.identity.userSummaries(ids)).map((u) => [u.id, u.name]));
    return rows.map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      actorUserId: e.actorUserId,
      actorName: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      requestId: e.requestId,
      details: e.details,
    }));
  }

  async list(access: AccessContext, query: Search) {
    const after = query.cursor === undefined ? undefined : cursorSchema.safeParse(query.cursor);
    if (after && !after.success) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, 'Invalid cursor.', [
        { path: 'cursor', code: 'invalid' },
      ]);
    }
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      this.rows(
        tx,
        [...this.conditions(query), after?.data ? lt(auditEvents.id, after.data) : undefined],
        query.limit + 1,
      ),
    );
    const page = rows.slice(0, query.limit);
    return {
      items: await this.withNames(page),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** The filtered trail as CSV (newest first, up to 5 000 events); the export itself is audited. */
  async exportCsv(req: Request, access: AccessContext, query: Search) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const found = await this.rows(tx, this.conditions(query), EXPORT_LIMIT);
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'audit.exported',
        actor: { userId: access.userId, membershipId: access.membershipId },
        details: {
          rows: found.length,
          filters: Object.keys(query).filter((k) => k !== 'limit' && k !== 'cursor'),
        },
      });
      return found;
    });
    const items = await this.withNames(rows);
    const header = [
      'occurred_at',
      'actor',
      'action',
      'target_type',
      'target_id',
      'request_id',
      'details',
    ];
    const lines = items.map((e) =>
      [
        e.occurredAt,
        e.actorName ?? '',
        e.action,
        e.targetType ?? '',
        e.targetId ?? '',
        e.requestId ?? '',
        JSON.stringify(e.details),
      ]
        .map(csvCell)
        .join(','),
    );
    return `\uFEFF${[header.join(','), ...lines].join('\r\n')}\r\n`;
  }
}
