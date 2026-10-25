import { HttpStatus, Injectable } from '@nestjs/common';
import { type TenantPublicProfile } from '@ultimate-erp/contracts';
import { tenants } from '@ultimate-erp/db';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';

@Injectable()
export class TenancyService {
  constructor(private readonly database: TenantDatabase) {}

  /** Public company profile for the login screen. RLS limits the query to this tenant's row. */
  async getPublicProfile(tenantId: string): Promise<TenantPublicProfile> {
    const [tenant] = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({
          slug: tenants.slug,
          nameEn: tenants.nameEn,
          nameAr: tenants.nameAr,
          defaultLocale: tenants.defaultLocale,
        })
        .from(tenants),
    );
    if (!tenant) {
      throw new AppError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'The requested resource was not found.',
      );
    }
    return {
      slug: tenant.slug,
      name: { en: tenant.nameEn, ar: tenant.nameAr },
      defaultLocale: tenant.defaultLocale,
    };
  }
}
