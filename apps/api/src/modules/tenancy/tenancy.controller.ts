import { Controller, Get } from '@nestjs/common';
import { type TenantPublicProfile } from '@ultimate-erp/contracts';
import { CurrentTenant, type TenantContext } from './tenant-context.js';
import { TenancyService } from './tenancy.service.js';

@Controller('tenant')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  /** Public profile of the company that owns this host (no login required, no business data). */
  @Get()
  getPublicProfile(@CurrentTenant() tenant: TenantContext): Promise<TenantPublicProfile> {
    return this.tenancy.getPublicProfile(tenant.tenantId);
  }
}
