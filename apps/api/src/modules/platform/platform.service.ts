import { isIP } from 'node:net';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type PlatformCompany,
  type PlatformOverview,
  PLATFORM_AUDIT_ACTIONS,
} from '@ultimate-erp/contracts';
import { type Database, platformAuditEvents, users } from '@ultimate-erp/db';
import { desc, eq, sql } from 'drizzle-orm';
import { type Request } from 'express';
import { type AppConfig, companyWebOrigin } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { DB } from '../../platform/database/database.tokens.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { clientIp } from '../../platform/request-context/client-ip.js';

type CompanyRow = {
  tenant_id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  status: 'active' | 'suspended';
  default_locale: 'en' | 'ar';
  created_at: Date | string;
  hostname: string | null;
  active_members: number;
  pending_invitations: number;
  owners: { name: string; email: string }[];
  last_activity_at: Date | string | null;
  files_bytes: string | number;
};

const iso = (value: Date | string) => new Date(value).toISOString();

/**
 * The platform console's data. Everything cross-company goes through the SECURITY DEFINER
 * functions of migration 0039, which return only directory facts and check the operator
 * themselves; this service never opens a company transaction and never reads business tables.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenantDb: TenantDatabase,
  ) {}

  /** True when the request host belongs to a company (the console is main-address only). */
  async isCompanyHost(hostname: string): Promise<boolean> {
    return (await this.tenantDb.resolveHost(hostname)) !== null;
  }

  async isOperator(userId: string): Promise<boolean> {
    const result = await this.db.execute<{ ok: boolean }>(
      sql`select app.is_platform_operator(${userId}) as ok`,
    );
    return result.rows[0]?.ok === true;
  }

  async overview(userId: string): Promise<PlatformOverview> {
    const result = await this.db.execute<{
      companies: number;
      companies_active: number;
      companies_suspended: number;
      companies_new_30d: number;
      people: number;
      accounts: number;
      sign_ins_7d: number;
      files_bytes: string | number;
    }>(sql`select * from app.platform_overview(${userId})`);
    const row = result.rows[0];
    if (!row) throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
    return {
      companies: row.companies,
      companiesActive: row.companies_active,
      companiesSuspended: row.companies_suspended,
      companiesNew30d: row.companies_new_30d,
      people: row.people,
      accounts: row.accounts,
      signIns7d: row.sign_ins_7d,
      filesBytes: String(row.files_bytes),
    };
  }

  async companies(
    userId: string,
    filter: { search?: string | undefined; status?: 'active' | 'suspended' | undefined },
  ): Promise<PlatformCompany[]> {
    const result = await this.db.execute<CompanyRow>(
      sql`select * from app.platform_companies(${userId})`,
    );
    const needle = filter.search?.trim().toLowerCase();
    return result.rows
      .filter((row) => !filter.status || row.status === filter.status)
      .filter(
        (row) =>
          !needle ||
          row.slug.includes(needle) ||
          row.name_en.toLowerCase().includes(needle) ||
          row.name_ar.includes(needle) ||
          row.owners.some((o) => o.email.toLowerCase().includes(needle)),
      )
      .map((row) => ({
        tenantId: row.tenant_id,
        slug: row.slug,
        name: { en: row.name_en, ar: row.name_ar },
        status: row.status,
        defaultLocale: row.default_locale,
        createdAt: iso(row.created_at),
        url: row.hostname ? companyWebOrigin(this.config, row.hostname) : null,
        activeMembers: row.active_members,
        pendingInvitations: row.pending_invitations,
        owners: row.owners,
        lastActivityAt: row.last_activity_at ? iso(row.last_activity_at) : null,
        filesBytes: String(row.files_bytes),
      }));
  }

  async company(userId: string, tenantId: string): Promise<PlatformCompany> {
    const found = (await this.companies(userId, {})).find((c) => c.tenantId === tenantId);
    if (!found) throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
    return found;
  }

  /** Suspends or reactivates a company and records why (platform audit, append-only). */
  async setStatus(
    req: Request,
    userId: string,
    tenantId: string,
    body: { status: 'active' | 'suspended'; reason: string },
  ): Promise<PlatformCompany> {
    const result = await this.db.execute<{ previous: string | null }>(
      sql`select app.platform_set_company_status(${userId}, ${tenantId}, ${body.status}) as previous`,
    );
    const previous = result.rows[0]?.previous ?? null;
    if (previous === null) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
    }
    if (previous !== body.status) {
      const ip = clientIp(req).replace(/^::ffff:/, '');
      await this.db.insert(platformAuditEvents).values({
        actorUserId: userId,
        action: body.status === 'suspended' ? PLATFORM_AUDIT_ACTIONS[0] : PLATFORM_AUDIT_ACTIONS[1],
        targetTenantId: tenantId,
        requestId: typeof req.id === 'string' ? req.id : null,
        ipAddress: isIP(ip) ? ip : null,
        details: { from: previous, to: body.status, reason: body.reason },
      });
    }
    return this.company(userId, tenantId);
  }

  /** The founders' own actions, newest first (last 200). */
  async auditEvents(userId: string) {
    if (!(await this.isOperator(userId))) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
    }
    // Company names come from the directory function: the tenants table itself is sealed by
    // row-level security outside a company context, as it should be.
    const slugs = new Map((await this.companies(userId, {})).map((c) => [c.tenantId, c.slug]));
    const rows = await this.db
      .select({
        id: platformAuditEvents.id,
        occurredAt: platformAuditEvents.occurredAt,
        action: platformAuditEvents.action,
        details: platformAuditEvents.details,
        actorName: users.name,
        tenantId: platformAuditEvents.targetTenantId,
      })
      .from(platformAuditEvents)
      .leftJoin(users, eq(users.id, platformAuditEvents.actorUserId))
      .orderBy(desc(platformAuditEvents.occurredAt), desc(platformAuditEvents.id))
      .limit(200);
    return rows.map((row) => {
      const slug = row.tenantId ? slugs.get(row.tenantId) : undefined;
      return {
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorName: row.actorName,
        action: row.action as (typeof PLATFORM_AUDIT_ACTIONS)[number],
        company: row.tenantId && slug ? { tenantId: row.tenantId, slug } : null,
        details: row.details,
      };
    });
  }
}
