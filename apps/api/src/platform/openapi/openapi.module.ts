import { Controller, Get, Inject, Module, NotFoundException } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { ApiContract } from './api-contract.js';
import { OpenApiService } from './openapi.service.js';

/** API documentation (brief §14). Development and test only: no route map in production. */
@Controller('docs')
export class OpenApiController {
  constructor(
    private readonly openApi: OpenApiService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('openapi.json')
  @ApiContract({ summary: 'OpenAPI document of this API (development only)', auth: 'public' })
  document() {
    if (this.config.NODE_ENV === 'production') throw new NotFoundException();
    return this.openApi.document();
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [OpenApiController],
  providers: [OpenApiService],
  exports: [OpenApiService],
})
export class OpenApiModule {}
