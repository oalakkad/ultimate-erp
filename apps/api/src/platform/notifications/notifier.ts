import { Global, Injectable, Module } from '@nestjs/common';
import { NOTIFICATION_RECIPIENT_LIMIT, type NotificationType } from '@ultimate-erp/contracts';
import { notifications, type TenantTransaction } from '@ultimate-erp/db';
import { type Request } from 'express';
import { AuditLog } from '../audit/audit-log.js';

export interface NotificationRequest {
  tenantId: string;
  type: NotificationType;
  /** User IDs, resolved by server code from the company's data — never from the browser. */
  recipients: readonly string[];
  /** Display values only (names, role keys). */
  params?: Record<string, string>;
  /** Relative path in the company app built from IDs; opening it re-checks access. */
  link?: string;
  /** Who caused it, for the audit trail. */
  actor: { userId: string; membershipId?: string | undefined };
}

/**
 * The one way any module notifies people (brief Module L; docs/modules/platform-jobs.md §3).
 * Runs in the caller's transaction, so a notification exists only if the change committed.
 * Recipients must be members of the company — the database refuses anyone else.
 */
@Injectable()
export class Notifier {
  constructor(private readonly audit: AuditLog) {}

  async notify(tx: TenantTransaction, req: Request, request: NotificationRequest): Promise<void> {
    const recipients = [...new Set(request.recipients)];
    if (recipients.length === 0) return;
    if (recipients.length > NOTIFICATION_RECIPIENT_LIMIT) {
      // A bug, not a user error: refuse rather than flood a company.
      throw new Error(
        `notify(${request.type}): ${recipients.length} recipients exceeds ${NOTIFICATION_RECIPIENT_LIMIT}`,
      );
    }
    await tx.insert(notifications).values(
      recipients.map((userId) => ({
        tenantId: request.tenantId,
        userId,
        type: request.type,
        params: request.params ?? {},
        link: request.link ?? null,
      })),
    );
    await this.audit.record(tx, req, {
      tenantId: request.tenantId,
      action: 'notifications.notification.sent',
      actor: request.actor,
      details: { type: request.type, recipients: recipients.length },
    });
  }
}

@Global()
@Module({ providers: [Notifier], exports: [Notifier] })
export class NotifierModule {}
