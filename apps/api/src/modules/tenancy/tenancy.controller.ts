import { Controller, Get } from '@nestjs/common';
import { type TenantPublicProfile, tenantPublicProfileSchema } from '@ultimate-erp/contracts';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { CurrentTenant, type TenantContext } from './tenant-context.js';
import { TenancyService } from './tenancy.service.js';

@Controller('tenant')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  /** Public profile of the company that owns this host (no login required, no business data). */
  @Get()
  @ApiContract({
    summary: 'Public profile of the company owning this host',
    auth: 'public',
    companyHost: true,
    response: tenantPublicProfileSchema,
  })
  getPublicProfile(@CurrentTenant() tenant: TenantContext): Promise<TenantPublicProfile> {
    return this.tenancy.getPublicProfile(tenant.tenantId);
  }
}
