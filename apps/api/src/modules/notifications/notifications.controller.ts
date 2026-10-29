import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  notificationIdParamSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  okResponseSchema,
  unreadCountResponseSchema,
} from '@ultimate-erp/contracts';
import { type z } from 'zod';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { NotificationsService } from './notifications.service.js';

/** My notifications in this company (docs/modules/platform-jobs.md §5). Member of this company. */
@Controller('notifications')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiContract({
    summary: 'My notifications, newest first',
    auth: 'member',
    companyHost: true,
    query: notificationListQuerySchema,
    response: notificationListResponseSchema,
  })
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(notificationListQuerySchema))
    query: z.infer<typeof notificationListQuerySchema>,
  ) {
    return this.notifications.list(access, query.limit, query.cursor);
  }

  @Get('unread-count')
  @ApiContract({
    summary: 'How many of my notifications are unread',
    auth: 'member',
    companyHost: true,
    response: unreadCountResponseSchema,
  })
  unreadCount(@CurrentAccess() access: AccessContext) {
    return this.notifications.unreadCount(access);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Mark all my notifications read',
    auth: 'member',
    companyHost: true,
    response: okResponseSchema,
  })
  async readAll(@CurrentAccess() access: AccessContext) {
    await this.notifications.markAllRead(access);
    return { status: 'ok' } as const;
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Mark one of my notifications read',
    auth: 'member',
    companyHost: true,
    params: notificationIdParamSchema,
    response: okResponseSchema,
  })
  async read(
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(notificationIdParamSchema)) params: { id: string },
  ) {
    await this.notifications.markRead(access, params.id);
    return { status: 'ok' } as const;
  }
}

@Module({
  imports: [AccessModule, IdentityModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
