import { Global, Inject, Injectable, Module } from '@nestjs/common';
import {
  MANDATORY_IN_APP,
  NOTIFICATION_RECIPIENT_LIMIT,
  type NotificationType,
} from '@ultimate-erp/contracts';
import {
  memberships,
  notificationPreferences,
  notifications,
  type TenantTransaction,
  tenants,
} from '@ultimate-erp/db';
import { translate } from '@ultimate-erp/i18n';
import { and, eq, inArray } from 'drizzle-orm';
import { type Request } from 'express';
// The identity module owns account data; the directory is its read-only, contact-only view.
import { UserDirectory } from '../../modules/identity/user-directory.js';
import { AuditLog } from '../audit/audit-log.js';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { EmailOutbox } from '../mail/email-outbox.js';

export interface NotificationRequest {
  tenantId: string;
  type: NotificationType;
  /** User IDs, resolved by server code from the company's data — never from the browser. */
  recipients: readonly string[];
  /** Display values only (names, role keys). */
  params?: Record<string, string>;
  /** Relative path in the company app built from IDs; opening it re-checks access. */
  link?: string;
  /** False when the caller sends its own email (announcements); default: per preferences. */
  emailCopies?: boolean;
  /** Who caused it, for the audit trail. */
  actor: { userId: string; membershipId?: string | undefined };
}

export type SystemNotificationRequest = Omit<NotificationRequest, 'actor'>;

/** The address of a company's own app, e.g. http://acme.localhost:5173. */
export function companyOrigin(config: AppConfig, slug: string): string {
  const web = new URL(config.WEB_PUBLIC_URL ?? config.APP_PUBLIC_URL);
  return `${web.protocol}//${slug}.${config.PLATFORM_BASE_DOMAIN}${web.port ? `:${web.port}` : ''}`;
}

/**
 * The one way any module notifies people (brief Module L; docs/modules/notifications.md).
 * Runs in the caller's transaction, so a notification exists only if the change committed.
 * Recipients must be members of the company — the database refuses anyone else. Each person's
 * preferences decide whether it shows in the app (mandatory types always do) and whether an
 * email copy is queued through the outbox (retries and delivery status included).
 */
@Injectable()
export class Notifier {
  constructor(
    private readonly audit: AuditLog,
    private readonly outbox: EmailOutbox,
    private readonly directory: UserDirectory,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async notify(tx: TenantTransaction, req: Request, request: NotificationRequest): Promise<void> {
    const { inApp, emailed } = await this.deliver(tx, request);
    if (inApp + emailed === 0) return;
    await this.audit.record(tx, req, {
      tenantId: request.tenantId,
      action: 'notifications.notification.sent',
      actor: request.actor,
      details: { type: request.type, recipients: inApp, emails: emailed },
    });
  }

  /** Same, for a background job: audited as the system with the job ID. */
  async notifySystem(tx: TenantTransaction, jobId: string, request: SystemNotificationRequest) {
    const { inApp, emailed } = await this.deliver(tx, request);
    if (inApp + emailed === 0) return;
    await this.audit.recordSystem(tx, jobId, {
      tenantId: request.tenantId,
      action: 'notifications.notification.sent',
      details: { type: request.type, recipients: inApp, emails: emailed },
    });
  }

  private async deliver(tx: TenantTransaction, request: SystemNotificationRequest) {
    const recipients = [...new Set(request.recipients)];
    if (recipients.length === 0) return { inApp: 0, emailed: 0 };
    if (recipients.length > NOTIFICATION_RECIPIENT_LIMIT) {
      // A bug, not a user error: refuse rather than flood a company.
      throw new Error(
        `notify(${request.type}): ${recipients.length} recipients exceeds ${NOTIFICATION_RECIPIENT_LIMIT}`,
      );
    }
    const prefs = await tx
      .select({
        userId: memberships.userId,
        inApp: notificationPreferences.inApp,
        email: notificationPreferences.email,
      })
      .from(notificationPreferences)
      .innerJoin(memberships, eq(memberships.id, notificationPreferences.membershipId))
      .where(
        and(
          eq(notificationPreferences.type, request.type),
          inArray(memberships.userId, recipients),
        ),
      );
    const byUser = new Map(prefs.map((p) => [p.userId, p]));
    const mandatory = MANDATORY_IN_APP.includes(request.type);
    const inApp = recipients.filter((u) => mandatory || byUser.get(u)?.inApp !== false);
    if (inApp.length > 0) {
      await tx.insert(notifications).values(
        inApp.map((userId) => ({
          tenantId: request.tenantId,
          userId,
          type: request.type,
          params: request.params ?? {},
          link: request.link ?? null,
        })),
      );
    }
    const wantEmail =
      request.emailCopies === false ? [] : recipients.filter((u) => byUser.get(u)?.email === true);
    let emailed = 0;
    if (wantEmail.length > 0) {
      const [tenant] = await tx
        .select({ slug: tenants.slug, nameEn: tenants.nameEn, nameAr: tenants.nameAr })
        .from(tenants);
      const origin = tenant ? companyOrigin(this.config, tenant.slug) : '';
      for (const person of await this.directory.contacts(wantEmail)) {
        if (!person.emailVerified || !tenant) continue;
        const key = `ui.notifications.types.${request.type.replace('.', '_')}` as Parameters<
          typeof translate
        >[1];
        await this.outbox.enqueue(
          {
            to: person.email,
            locale: person.locale,
            template: 'notification',
            params: {
              name: person.name,
              company: person.locale === 'ar' ? tenant.nameAr : tenant.nameEn,
              message: translate(person.locale, key, request.params ?? {}),
              url: `${origin}${request.link ?? '/'}`,
            },
          },
          tx,
        );
        emailed += 1;
      }
    }
    return { inApp: inApp.length, emailed };
  }
}

@Global()
@Module({ providers: [Notifier], exports: [Notifier] })
export class NotifierModule {}
