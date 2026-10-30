import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  approvalListResponseSchema,
  createTimeEntryRequestSchema,
  entryIdsRequestSchema,
  okResponseSchema,
  rejectEntriesRequestSchema,
  reopenEntryRequestSchema,
  taskIdParamSchema,
  taskTimeSchema,
  timeEntryIdParamSchema,
  timeEntrySchema,
  timerSchema,
  timerStartRequestSchema,
  timerStopRequestSchema,
  timesheetIdParamSchema,
  timesheetSchema,
  timeSummaryQuerySchema,
  timeSummarySchema,
  updateTimeEntryRequestSchema,
  weekQuerySchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { NotifierModule } from '../../platform/notifications/notifier.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TimeService } from './time.service.js';

type Id = { id: string };
const entryPipe = new ZodValidationPipe(timeEntryIdParamSchema);
const LOG = 'time.entry.create';
const READ = 'time.entry.read';
const APPROVE = 'time.timesheet.approve';

/** My time is always "own" scope; approvals are checked per entry's project in the service. */
@Controller()
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class TimeController {
  constructor(private readonly time: TimeService) {}

  @Get('timesheets/mine')
  @ApiContract({
    summary: 'My timesheet for the week containing a date (default: this week)',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    query: weekQuerySchema,
    response: timesheetSchema,
  })
  @RequirePermission(LOG, 'own')
  mine(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(weekQuerySchema)) query: { week?: string },
  ) {
    return this.time.myWeek(access, query.week);
  }

  @Post('timesheets/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Submit my week for approval',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    params: timesheetIdParamSchema,
    response: timesheetSchema,
  })
  @RequirePermission(LOG, 'own')
  submit(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(timesheetIdParamSchema)) params: Id,
  ) {
    return this.time.submit(req, access, params.id);
  }

  @Post('time-entries')
  @ApiContract({
    summary: 'Log time on a task I am assigned to',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    body: createTimeEntryRequestSchema,
    response: timeEntrySchema,
  })
  @RequirePermission(LOG, 'own')
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createTimeEntryRequestSchema))
    body: z.output<typeof createTimeEntryRequestSchema>,
  ) {
    return this.time.create(req, access, body);
  }

  @Patch('time-entries/:id')
  @ApiContract({
    summary: 'Correct one of my draft or rejected entries',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    params: timeEntryIdParamSchema,
    body: updateTimeEntryRequestSchema,
    response: timeEntrySchema,
  })
  @RequirePermission(LOG, 'own')
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(entryPipe) params: Id,
    @Body(new ZodValidationPipe(updateTimeEntryRequestSchema))
    body: z.output<typeof updateTimeEntryRequestSchema>,
  ) {
    return this.time.update(req, access, params.id, body);
  }

  @Delete('time-entries/:id')
  @ApiContract({
    summary: 'Delete one of my draft or rejected entries',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    params: timeEntryIdParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(LOG, 'own')
  async remove(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(entryPipe) params: Id,
  ) {
    await this.time.remove(req, access, params.id);
    return { status: 'ok' } as const;
  }

  @Get('approvals/time')
  @ApiContract({
    summary: 'Submitted entries waiting for my approval',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    response: approvalListResponseSchema,
  })
  @RequirePermission(APPROVE, 'team')
  async approvals(@CurrentAccess() access: AccessContext) {
    return { items: await this.time.approvals(access) };
  }

  @Post('time-entries/approve')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Approve submitted entries (never my own)',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    body: entryIdsRequestSchema,
    response: approvalListResponseSchema,
  })
  @RequirePermission(APPROVE, 'team')
  async approve(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(entryIdsRequestSchema)) body: { ids: string[] },
  ) {
    return { items: await this.time.decide(req, access, body.ids, 'approved') };
  }

  @Post('time-entries/reject')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Send submitted entries back for correction, with a reason',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    body: rejectEntriesRequestSchema,
    response: approvalListResponseSchema,
  })
  @RequirePermission(APPROVE, 'team')
  async reject(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(rejectEntriesRequestSchema))
    body: { ids: string[]; reason: string },
  ) {
    return { items: await this.time.decide(req, access, body.ids, 'rejected', body.reason) };
  }

  @Post('time-entries/:id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Reopen an approved entry for correction (reason recorded)',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: timeEntryIdParamSchema,
    body: reopenEntryRequestSchema,
    response: timeEntrySchema,
  })
  @RequirePermission(APPROVE, 'team')
  reopen(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(entryPipe) params: Id,
    @Body(new ZodValidationPipe(reopenEntryRequestSchema)) body: { reason: string },
  ) {
    return this.time.reopen(req, access, params.id, body.reason);
  }

  @Get('timer')
  @ApiContract({
    summary: 'My running timer, if any',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    response: timerSchema,
  })
  @RequirePermission(LOG, 'own')
  timer(@CurrentAccess() access: AccessContext) {
    return this.time.timer(access);
  }

  @Post('timer')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Start a timer on a task I am assigned to',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    body: timerStartRequestSchema,
    response: timerSchema,
  })
  @RequirePermission(LOG, 'own')
  start(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(timerStartRequestSchema)) body: { taskId: string },
  ) {
    return this.time.startTimer(req, access, body.taskId);
  }

  @Post('timer/stop')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Stop my timer; the elapsed time becomes a draft entry',
    auth: 'member',
    permission: LOG,
    companyHost: true,
    body: timerStopRequestSchema,
    response: timeEntrySchema,
  })
  @RequirePermission(LOG, 'own')
  stop(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(timerStopRequestSchema)) body: { description?: string },
  ) {
    return this.time.stopTimer(req, access, body.description);
  }

  @Get('time/summary')
  @ApiContract({
    summary: 'Hours for a period: per day, per project, billable vs non-billable',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: timeSummaryQuerySchema,
    response: timeSummarySchema,
  })
  @RequirePermission(READ, 'own')
  summary(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(timeSummaryQuerySchema))
    query: z.output<typeof timeSummaryQuerySchema>,
  ) {
    return this.time.summary(access, query.from, query.to, query.membershipId);
  }

  @Get('tasks/:id/time')
  @ApiContract({
    summary: 'Allocated vs logged vs approved hours per person on a task',
    auth: 'member',
    permission: 'tasks.task.read',
    companyHost: true,
    params: taskIdParamSchema,
    response: taskTimeSchema,
  })
  @RequirePermission('tasks.task.read', 'own')
  taskTime(
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(taskIdParamSchema)) params: Id,
  ) {
    return this.time.taskTime(access, params.id);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, NotifierModule],
  controllers: [TimeController],
  providers: [TimeService],
})
export class TimeModule {}
