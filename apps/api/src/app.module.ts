import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AccessModule, SignInPolicyModule } from './modules/access/access.module.js';
import { ClientsModule } from './modules/clients/clients.controller.js';
import { DashboardModule } from './modules/dashboard/dashboard.controller.js';
import { FilesModule } from './modules/files/files.controller.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { NotificationsModule } from './modules/notifications/notifications.controller.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { type AppConfig } from './platform/config/config.js';
import { AuditModule } from './platform/audit/audit.module.js';
import { ConfigModule } from './platform/config/config.module.js';
import { DatabaseModule } from './platform/database/database.module.js';
import { GlobalExceptionFilter } from './platform/errors/global-exception.filter.js';
import { HealthModule } from './platform/health/health.module.js';
import { JobsModule } from './platform/jobs/jobs.module.js';
import { NotifierModule } from './platform/notifications/notifier.js';
import { LoggingModule } from './platform/logging/logging.module.js';
import { MailModule } from './platform/mail/mail.module.js';
import { OpenApiModule } from './platform/openapi/openapi.module.js';
import { RateLimitModule } from './platform/rate-limit/rate-limit.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggingModule.forRoot(config),
        DatabaseModule.forRoot(config),
        JobsModule.forRoot('producer'),
        MailModule,
        AuditModule,
        NotifierModule,
        RateLimitModule,
        HealthModule,
        TenancyModule,
        IdentityModule,
        SignInPolicyModule,
        AccessModule,
        NotificationsModule,
        FilesModule,
        DashboardModule,
        ClientsModule,
        OpenApiModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    };
  }
}
