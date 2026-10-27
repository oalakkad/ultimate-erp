import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenancyController } from './tenancy.controller.js';
import { TenancyService } from './tenancy.service.js';

@Module({
  controllers: [TenancyController],
  providers: [TenancyService],
})
export class TenancyModule implements NestModule {
  /**
   * Every route needs a tenant, except platform health checks and identity (/auth: one account
   * spans companies; sign-up and sign-in happen before a company is chosen). Applying the middleware to all
   * routes (rather than per controller) means a new module cannot forget it.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'auth/*path', method: RequestMethod.ALL },
      )
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
