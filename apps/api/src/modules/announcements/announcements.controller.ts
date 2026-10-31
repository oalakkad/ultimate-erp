import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  type Announcement,
  announcementListResponseSchema,
  announcementPreviewRequestSchema,
  announcementPreviewSchema,
  announcementSchema,
  hasPermission,
  NOTIFICATION_RECIPIENT_LIMIT,
  publishAnnouncementRequestSchema,
  type Role,
} from '@ultimate-erp/contracts';
import {
  announcementEmails,
  announcements,
  emailDeliveries,
  membershipRoles,
  memberships,
  type TenantTransaction,
  tenants,
} from '@ultimate-erp/db';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { type Request } from 'express';
import { type z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { type AppConfig } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { EmailOutbox } from '../../platform/mail/email-outbox.js';
import { companyOrigin, Notifier } from '../../platform/notifications/notifier.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IdentityService } from '../identity/identity.service.js';
import { UserDirectory } from '../identity/user-directory.js';

const PUBLISH = 'announcements.publish';
/** At most this many announcements per company per day (protection against mistakes). */
const DAILY_LIMIT = 10;
const forbidden = () => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, messageFor('FORBIDDEN'));
const conflict = (path: string, code: string, message: string) =>
  new AppError('CONFLICT', HttpStatus.CONFLICT, message, [{ path, code }]);

/** Company announcements (docs/modules/notifications.md §4). */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly outbox: EmailOutbox,
    private readonly directory: UserDirectory,
    private readonly identity: IdentityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Active members who would receive it (any of the roles; empty = everyone). */
  private async audience(tx: TenantTransaction, roles: readonly string[]) {
    const rows =
      roles.length === 0
        ? await tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(eq(memberships.status, 'active'))
        : await tx
            .selectDistinct({ userId: memberships.userId })
            .from(memberships)
            .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
            .where(
              and(eq(memberships.status, 'active'), inArray(membershipRoles.role, roles as Role[])),
            );
    return [...new Set(rows.map((r) => r.userId))];
  }

  async preview(access: AccessContext, roles: Role[]) {
    if (!hasPermission(access.permissions, PUBLISH, 'company')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => ({
      recipients: (await this.audience(tx, roles)).length,
    }));
  }

  async publish(
    req: Request,
    access: AccessContext,
    input: z.output<typeof publishAnnouncementRequestSchema>,
  ) {
    if (!hasPermission(access.permissions, PUBLISH, 'company')) throw forbidden();
    const id = await this.database.withTenant(access.tenantId, async (tx) => {
      const since = new Date(Date.now() - 86_400_000);
      const recent = await tx
        .select({ id: announcements.id })
        .from(announcements)
        .where(gte(announcements.publishedAt, since));
      if (recent.length >= DAILY_LIMIT)
        throw conflict('announcement', 'daily_limit', 'Too many announcements today.');
      const people = await this.audience(tx, input.roles);
      if (people.length !== input.confirmRecipients) {
        throw conflict(
          'confirmRecipients',
          'recipient_count_changed',
          'The number of recipients changed; check the preview again.',
        );
      }
      const [row] = await tx
        .insert(announcements)
        .values({
          tenantId: access.tenantId,
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          bodyEn: input.bodyEn,
          bodyAr: input.bodyAr,
          roles: input.roles,
          email: input.email,
          recipients: people.length,
          publishedByUserId: access.userId,
        })
        .returning();
      if (!row) throw new Error('announcement insert returned nothing');
      for (let i = 0; i < people.length; i += NOTIFICATION_RECIPIENT_LIMIT) {
        await this.notifier.notify(tx, req, {
          tenantId: access.tenantId,
          type: 'announcements.published',
          recipients: people.slice(i, i + NOTIFICATION_RECIPIENT_LIMIT),
          params: { title: input.titleEn, titleAr: input.titleAr },
          link: '/announcements',
          emailCopies: false,
          actor: { userId: access.userId, membershipId: access.membershipId },
        });
      }
      if (input.email) {
        const [tenant] = await tx.select().from(tenants);
        const origin = tenant ? companyOrigin(this.config, tenant.slug) : '';
        for (const person of await this.directory.contacts(people)) {
          if (!person.emailVerified || !tenant) continue;
          const ar = person.locale === 'ar';
          const deliveryId = await this.outbox.enqueue(
            {
              to: person.email,
              locale: person.locale,
              template: 'announcement',
              params: {
                name: person.name,
                company: ar ? tenant.nameAr : tenant.nameEn,
                title: ar ? input.titleAr : input.titleEn,
                text: ar ? input.bodyAr : input.bodyEn,
                url: `${origin}/announcements`,
              },
            },
            tx,
          );
          await tx
            .insert(announcementEmails)
            .values({ tenantId: access.tenantId, announcementId: row.id, deliveryId });
        }
      }
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'announcements.announcement.published',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'announcement', id: row.id },
        details: { recipients: people.length, roles: input.roles, email: input.email },
      });
      return row.id;
    });
    const list = await this.list(access);
    const found = list.items.find((a) => a.id === id);
    if (!found) throw new Error('published announcement not visible to its publisher');
    return found;
  }

  /** Announcements addressed to me (all of them for people who may publish). */
  async list(access: AccessContext): Promise<{ items: Announcement[] }> {
    const publisher = hasPermission(access.permissions, PUBLISH, 'company');
    const { rows, myRoles, deliveries } = await this.database.withTenant(
      access.tenantId,
      async (tx) => {
        const found = await tx
          .select()
          .from(announcements)
          .orderBy(desc(announcements.publishedAt))
          .limit(100);
        const roles = (
          await tx
            .select({ role: membershipRoles.role })
            .from(membershipRoles)
            .where(eq(membershipRoles.membershipId, access.membershipId))
        ).map((r) => r.role);
        const delivery =
          publisher && found.length
            ? await tx
                .select({
                  announcementId: announcementEmails.announcementId,
                  status: emailDeliveries.status,
                })
                .from(announcementEmails)
                .innerJoin(emailDeliveries, eq(emailDeliveries.id, announcementEmails.deliveryId))
                .where(
                  inArray(
                    announcementEmails.announcementId,
                    found.map((f) => f.id),
                  ),
                )
            : [];
        return { rows: found, myRoles: roles, deliveries: delivery };
      },
    );
    const visible = rows.filter(
      (r) => publisher || r.roles.length === 0 || r.roles.some((role) => myRoles.includes(role)),
    );
    const names = new Map(
      (
        await this.identity.userSummaries([...new Set(visible.map((r) => r.publishedByUserId))])
      ).map((u) => [u.id, u.name]),
    );
    return {
      items: visible.map((r) => {
        const mine = deliveries.filter((d) => d.announcementId === r.id);
        return {
          id: r.id,
          title: { en: r.titleEn, ar: r.titleAr },
          body: { en: r.bodyEn, ar: r.bodyAr },
          roles: r.roles as Role[],
          email: r.email,
          recipients: r.recipients,
          publishedByName: names.get(r.publishedByUserId) ?? null,
          publishedAt: r.publishedAt.toISOString(),
          delivery:
            publisher && r.email
              ? {
                  queued: mine.filter((d) => d.status === 'queued').length,
                  sent: mine.filter((d) => d.status === 'sent').length,
                  failed: mine.filter((d) => d.status === 'failed').length,
                }
              : null,
        };
      }),
    };
  }
}

@Controller('announcements')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @ApiContract({
    summary: 'Announcements addressed to me',
    auth: 'member',
    companyHost: true,
    response: announcementListResponseSchema,
  })
  list(@CurrentAccess() access: AccessContext) {
    return this.announcements.list(access);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'How many people an announcement would reach',
    auth: 'member',
    permission: PUBLISH,
    companyHost: true,
    body: announcementPreviewRequestSchema,
    response: announcementPreviewSchema,
  })
  @RequirePermission(PUBLISH)
  preview(
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(announcementPreviewRequestSchema)) body: { roles: Role[] },
  ) {
    return this.announcements.preview(access, body.roles);
  }

  @Post()
  @ApiContract({
    summary: 'Publish (recipient count must be confirmed; audited)',
    auth: 'member',
    permission: PUBLISH,
    companyHost: true,
    body: publishAnnouncementRequestSchema,
    response: announcementSchema,
  })
  @RequirePermission(PUBLISH)
  publish(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(publishAnnouncementRequestSchema))
    body: z.output<typeof publishAnnouncementRequestSchema>,
  ) {
    return this.announcements.publish(req, access, body);
  }
}

@Module({
  imports: [AccessModule, IdentityModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
