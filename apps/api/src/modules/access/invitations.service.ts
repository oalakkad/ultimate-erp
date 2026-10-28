import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { canGrant, isRole, isSensitive, type Role } from '@ultimate-erp/contracts';
import {
  invitations,
  membershipRoles,
  memberships,
  tenantDomains,
  tenants,
} from '@ultimate-erp/db';
import { catalogs } from '@ultimate-erp/i18n';
import { and, desc, eq, gt, isNotNull } from 'drizzle-orm';
import { type Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { type AppConfig, companyWebOrigin } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { Mailer } from '../../platform/mail/mailer.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { clientIp } from '../../platform/request-context/client-ip.js';
import { type Identity, IdentityService } from '../identity/identity.service.js';
import { type AccessContext } from './access-context.js';

const VALID_DAYS = 7;
const TOKEN_LIMIT = { name: 'invitation-token:ip', limit: 30, windowSeconds: 5 * 60 };
const INVITE_LIMIT = { name: 'invitation-create:member', limit: 50, windowSeconds: 24 * 60 * 60 };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const invalidToken = () =>
  new AppError('INVALID_TOKEN', HttpStatus.BAD_REQUEST, messageFor('INVALID_TOKEN'));

/** `omar@example.com` → `o***@example.com` (a forwarded link should not reveal the address). */
const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

/** Invitations: the only way into a company besides founding it (brief §6). */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly identity: IdentityService,
    private readonly audit: AuditLog,
    private readonly mailer: Mailer,
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectPinoLogger(InvitationsService.name) private readonly logger: PinoLogger,
  ) {}

  async create(req: Request, access: AccessContext, email: string, role: Role) {
    await this.limiter.consume(INVITE_LIMIT, access.membershipId);
    if (!canGrant(access.roles, [role])) {
      throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, 'You cannot invite into this role.');
    }
    const existingUserId = await this.identity.userIdByEmail(email);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000);

    const { invitation, company, host } = await this.database.withTenant(
      access.tenantId,
      async (tx) => {
        if (existingUserId) {
          const [member] = await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eq(memberships.userId, existingUserId), eq(memberships.status, 'active')));
          if (member) throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Already a member.');
        }
        // A new invitation replaces any pending one for the same address.
        await tx
          .update(invitations)
          .set({ status: 'revoked' })
          .where(and(eq(invitations.email, email), eq(invitations.status, 'pending')));
        const [created] = await tx
          .insert(invitations)
          .values({
            tenantId: access.tenantId,
            email,
            role,
            invitedByMembershipId: access.membershipId,
            tokenHash: hashToken(token),
            expiresAt,
          })
          .returning();
        if (!created) throw new Error('invitation insert returned nothing');
        await this.audit.record(tx, req, {
          tenantId: access.tenantId,
          action: 'access.invitation.created',
          actor: { userId: access.userId, membershipId: access.membershipId },
          target: { type: 'invitation', id: created.id },
          details: { email, role },
        });
        const [tenant] = await tx.select().from(tenants);
        const [domain] = await tx
          .select({ hostname: tenantDomains.hostname })
          .from(tenantDomains)
          .where(isNotNull(tenantDomains.verifiedAt))
          .orderBy(tenantDomains.createdAt);
        if (!tenant || !domain) throw new Error('tenant without profile or domain');
        return { invitation: created, company: tenant, host: domain.hostname };
      },
    );

    // Sent after commit; the invitation stays valid if mail fails (it can be re-sent).
    const [inviter] = await this.identity.userSummaries([access.userId]);
    const locale = company.defaultLocale;
    const url = new URL('/invitations/accept', companyWebOrigin(this.config, host));
    url.searchParams.set('token', token);
    try {
      await this.mailer.send({
        to: email,
        locale,
        template: 'invitation',
        params: {
          company: locale === 'ar' ? company.nameAr : company.nameEn,
          inviter: inviter?.name ?? '',
          role: catalogs[locale].roles[role],
          url: url.toString(),
        },
      });
    } catch (err) {
      this.logger.error({ err }, 'Failed to send invitation email');
    }
    return this.toDto(invitation);
  }

  async listPending(access: AccessContext) {
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.status, 'pending'), gt(invitations.expiresAt, new Date())))
        .orderBy(desc(invitations.createdAt)),
    );
    return rows.map((row) => this.toDto(row));
  }

  async revoke(req: Request, access: AccessContext, invitationId: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      const [revoked] = await tx
        .update(invitations)
        .set({ status: 'revoked' })
        .where(and(eq(invitations.id, invitationId), eq(invitations.status, 'pending')))
        .returning({ id: invitations.id });
      if (!revoked) throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'access.invitation.revoked',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'invitation', id: invitationId },
      });
    });
  }

  /** What the invitee sees before accepting (no session needed). */
  async preview(req: Request, tenantId: string, token: string) {
    await this.limiter.consume(TOKEN_LIMIT, clientIp(req));
    return this.database.withTenant(tenantId, async (tx) => {
      const invitation = await this.findUsable(tx, token);
      const [company] = await tx.select().from(tenants);
      if (!company) throw invalidToken();
      return {
        company: { en: company.nameEn, ar: company.nameAr },
        role: invitation.role,
        emailHint: maskEmail(invitation.email),
        expiresAt: invitation.expiresAt.toISOString(),
      };
    });
  }

  /**
   * Accepts with the signed-in account. The account's email must be verified and equal the
   * invited address (email domain alone is never proof — brief §6). Single use.
   */
  async accept(req: Request, tenantId: string, identity: Identity, token: string) {
    await this.limiter.consume(TOKEN_LIMIT, clientIp(req));
    const [user] = await this.identity.userSummaries([identity.userId]);
    const role = await this.database.withTenant(tenantId, async (tx) => {
      const invitation = await this.findUsable(tx, token, true);
      if (!user?.emailVerified || user.email.toLowerCase() !== invitation.email) {
        throw new AppError(
          'FORBIDDEN',
          HttpStatus.FORBIDDEN,
          'This invitation is for a different email address.',
        );
      }
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.userId, identity.userId))
        .for('update');
      if (existing?.status === 'active') {
        throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Already a member.');
      }
      let membershipId: string;
      if (existing) {
        // A former member rejoins: same membership row, history kept, roles replaced.
        await tx
          .update(memberships)
          .set({ status: 'active', joinedAt: new Date() })
          .where(eq(memberships.id, existing.id));
        await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, existing.id));
        membershipId = existing.id;
      } else {
        const [created] = await tx
          .insert(memberships)
          .values({
            tenantId,
            userId: identity.userId,
            status: 'active',
            joinedAt: new Date(),
            invitedByMembershipId: invitation.invitedByMembershipId,
          })
          .returning({ id: memberships.id });
        if (!created) throw new Error('membership insert returned nothing');
        membershipId = created.id;
      }
      await tx.insert(membershipRoles).values({ tenantId, membershipId, role: invitation.role });
      await tx
        .update(invitations)
        .set({ status: 'accepted', acceptedMembershipId: membershipId })
        .where(eq(invitations.id, invitation.id));
      await this.audit.record(tx, req, {
        tenantId,
        action: 'access.invitation.accepted',
        actor: { userId: identity.userId, membershipId },
        target: { type: 'invitation', id: invitation.id },
        details: { role: invitation.role },
      });
      return invitation.role;
    });
    if (isSensitive([role])) await this.identity.revokeTrustedDevices(identity.userId);
    return { status: 'ok' as const };
  }

  private async findUsable(
    tx: Parameters<Parameters<TenantDatabase['withTenant']>[1]>[0],
    token: string,
    lock = false,
  ) {
    const query = tx
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, hashToken(token)),
          eq(invitations.status, 'pending'),
          gt(invitations.expiresAt, new Date()),
        ),
      );
    const [invitation] = lock ? await query.for('update') : await query;
    if (!invitation || !isRole(invitation.role)) throw invalidToken();
    return { ...invitation, role: invitation.role };
  }

  private toDto(row: typeof invitations.$inferSelect) {
    if (!isRole(row.role)) throw new Error(`unknown role ${row.role}`);
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
