import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { FOUNDER_ROLES } from '@ultimate-erp/contracts';
import { membershipRoles, memberships, tenantDomains, tenants } from '@ultimate-erp/db';
import { type Request } from 'express';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { type AppConfig, companyWebOrigin } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { type Identity, IdentityService } from '../identity/identity.service.js';

const CREATE_LIMIT = { name: 'company-create:user', limit: 5, windowSeconds: 24 * 60 * 60 };

/** Self-service company onboarding (brief §6; decision 2026-10-25: anyone after verification). */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly identity: IdentityService,
    private readonly audit: AuditLog,
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates the company, its subdomain (ours, so verified by construction), and the founder's
   * active membership as Owner + CEO — all in one transaction, with an audit event.
   */
  async create(
    req: Request,
    identity: Identity,
    body: { slug: string; nameEn: string; nameAr: string; defaultLocale: 'en' | 'ar' },
  ) {
    await this.limiter.consume(CREATE_LIMIT, identity.userId);
    const [user] = await this.identity.userSummaries([identity.userId]);
    if (!user?.emailVerified) {
      throw new AppError('EMAIL_NOT_VERIFIED', HttpStatus.FORBIDDEN, 'Verify your email first.');
    }

    const tenantId = await this.database.newTenantId();
    const hostname = `${body.slug}.${this.config.PLATFORM_BASE_DOMAIN}`;
    try {
      await this.database.withTenant(tenantId, async (tx) => {
        await tx.insert(tenants).values({
          id: tenantId,
          slug: body.slug,
          nameEn: body.nameEn,
          nameAr: body.nameAr,
          defaultLocale: body.defaultLocale,
        });
        await tx
          .insert(tenantDomains)
          .values({ tenantId, hostname, kind: 'subdomain', verifiedAt: new Date() });
        const [member] = await tx
          .insert(memberships)
          .values({ tenantId, userId: identity.userId, status: 'active', joinedAt: new Date() })
          .returning({ id: memberships.id });
        if (!member) throw new Error('membership insert returned nothing');
        await tx
          .insert(membershipRoles)
          .values(FOUNDER_ROLES.map((role) => ({ tenantId, membershipId: member.id, role })));
        await this.audit.record(tx, req, {
          tenantId,
          action: 'access.company.created',
          actor: { userId: identity.userId, membershipId: member.id },
          target: { type: 'tenant', id: tenantId },
          details: { slug: body.slug, roles: FOUNDER_ROLES },
        });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION) {
        throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'This company address is taken.');
      }
      throw err;
    }
    // The founder now holds sensitive roles: any trusted device no longer skips two-factor.
    await this.identity.revokeTrustedDevices(identity.userId);
    return {
      tenantId,
      slug: body.slug,
      url: companyWebOrigin(this.config, hostname),
      twoFactorRequired: !user.twoFactorEnabled,
    };
  }
}
