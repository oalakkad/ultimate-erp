import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AccessModule, SignInPolicyModule } from './modules/access/access.module.js';
import { ClientsModule } from './modules/clients/clients.controller.js';
import { ContractsModule } from './modules/contracts/contracts.controller.js';
import { ProjectsModule } from './modules/projects/projects.controller.js';
import { TasksModule } from './modules/tasks/tasks.controller.js';
import { TimeModule } from './modules/time/time.controller.js';
import { PeopleModule } from './modules/people/people.controller.js';
import { LeaveModule } from './modules/leave/leave.controller.js';
import { AttendanceModule } from './modules/attendance/attendance.controller.js';
import { PayrollModule } from './modules/payroll/payroll.controller.js';
import { BillingModule } from './modules/billing/billing.controller.js';
import { AnnouncementsModule } from './modules/announcements/announcements.controller.js';
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
import { UserDirectoryModule } from './modules/identity/user-directory.js';
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
        UserDirectoryModule,
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
        ContractsModule,
        ProjectsModule,
        TasksModule,
        TimeModule,
        PeopleModule,
        LeaveModule,
        AttendanceModule,
        PayrollModule,
        BillingModule,
        AnnouncementsModule,
        OpenApiModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    };
  }
}
