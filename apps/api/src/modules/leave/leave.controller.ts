import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  holidayListResponseSchema,
  holidayQuerySchema,
  holidaysRequestSchema,
  leaveAdjustmentRequestSchema,
  leaveApplicationSchema,
  leaveBalanceQuerySchema,
  leaveBalanceSchema,
  leaveCalendarQuerySchema,
  leaveCalendarSchema,
  leaveDecisionSchema,
  leaveIdParamSchema,
  leaveListQuerySchema,
  leaveListResponseSchema,
  leavePreviewSchema,
  leaveReasonSchema,
  leaveRequestSchema,
  leaveTypeListResponseSchema,
  leaveTypeRequestSchema,
  leaveTypeUpdateSchema,
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
import { LeaveService } from './leave.service.js';

type Id = { id: string };
const idPipe = new ZodValidationPipe(leaveIdParamSchema);
const APPLY = 'leave.request.create';
const READ = 'leave.request.read';
const APPROVE = 'leave.request.approve';
const POLICY = 'leave.policy.manage';

/** Leave (docs/modules/leave.md). Team scope and "not my own" are checked per request in the service. */
@Controller('leave')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  @ApiContract({
    summary: 'Leave types (company policies; pre-filled ones are flagged "to be verified")',
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    response: leaveTypeListResponseSchema,
  })
  @RequirePermission(APPLY, 'own')
  types(@CurrentAccess() access: AccessContext) {
    return this.leave.types(access);
  }

  @Post('types')
  @ApiContract({
    summary: 'Add a leave type',
    auth: 'member',
    permission: POLICY,
    companyHost: true,
    body: leaveTypeRequestSchema,
    response: leaveTypeListResponseSchema,
  })
  @RequirePermission(POLICY)
  createType(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(leaveTypeRequestSchema))
    body: z.output<typeof leaveTypeRequestSchema>,
  ) {
    return this.leave.createType(req, access, body);
  }

  @Patch('types/:id')
  @ApiContract({
    summary: 'Edit, archive or confirm-as-verified a leave type',
    auth: 'member',
    permission: POLICY,
    companyHost: true,
    params: leaveIdParamSchema,
    body: leaveTypeUpdateSchema,
    response: leaveTypeListResponseSchema,
  })
  @RequirePermission(POLICY)
  updateType(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(leaveTypeUpdateSchema))
    body: z.output<typeof leaveTypeUpdateSchema>,
  ) {
    return this.leave.updateType(req, access, params.id, body);
  }

  @Get('holidays')
  @ApiContract({
    summary: 'Public holidays of a year',
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    query: holidayQuerySchema,
    response: holidayListResponseSchema,
  })
  @RequirePermission(APPLY, 'own')
  holidays(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(holidayQuerySchema)) query: { year: number },
  ) {
    return this.leave.holidays(access, query.year);
  }

  @Put('holidays')
  @ApiContract({
    summary: 'Replace the public holidays of a year',
    auth: 'member',
    permission: POLICY,
    companyHost: true,
    body: holidaysRequestSchema,
    response: holidayListResponseSchema,
  })
  @RequirePermission(POLICY)
  setHolidays(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(holidaysRequestSchema))
    body: z.output<typeof holidaysRequestSchema>,
  ) {
    return this.leave.setHolidays(req, access, body.year, body.holidays);
  }

  @Get('balances')
  @ApiContract({
    summary: 'Balances of a person for a year (default: me, this year)',
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    query: leaveBalanceQuerySchema,
    response: leaveBalanceSchema,
  })
  @RequirePermission(APPLY, 'own')
  balances(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(leaveBalanceQuerySchema))
    query: z.output<typeof leaveBalanceQuerySchema>,
  ) {
    return this.leave.balances(access, query.membershipId, query.year);
  }

  @Post('adjustments')
  @ApiContract({
    summary: 'Adjust a balance with a note (e.g. carry-over)',
    auth: 'member',
    permission: POLICY,
    companyHost: true,
    body: leaveAdjustmentRequestSchema,
    response: leaveBalanceSchema,
  })
  @RequirePermission(POLICY)
  adjust(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(leaveAdjustmentRequestSchema))
    body: z.output<typeof leaveAdjustmentRequestSchema>,
  ) {
    return this.leave.adjust(req, access, body);
  }

  @Get('requests')
  @ApiContract({
    summary: "My requests, requests waiting for me, or one person's",
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    query: leaveListQuerySchema,
    response: leaveListResponseSchema,
  })
  @RequirePermission(APPLY, 'own')
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(leaveListQuerySchema))
    query: z.output<typeof leaveListQuerySchema>,
  ) {
    return this.leave.list(access, query);
  }

  @Post('requests/preview')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Working days and balance an application would use (nothing saved)',
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    body: leaveApplicationSchema,
    response: leavePreviewSchema,
  })
  @RequirePermission(APPLY, 'own')
  async preview(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(leaveApplicationSchema))
    body: z.output<typeof leaveApplicationSchema>,
  ) {
    const result = await this.leave.apply(req, access, { ...body, preview: true });
    return 'preview' in result ? result.preview : null;
  }

  @Post('requests')
  @ApiContract({
    summary: 'Apply for leave',
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    body: leaveApplicationSchema,
    response: leaveRequestSchema,
  })
  @RequirePermission(APPLY, 'own')
  async apply(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(leaveApplicationSchema))
    body: z.output<typeof leaveApplicationSchema>,
  ) {
    const result = await this.leave.apply(req, access, { ...body, preview: false });
    return 'request' in result ? result.request : null;
  }

  @Post('requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Approve (balance deducted once)',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: leaveIdParamSchema,
    body: leaveDecisionSchema,
    response: leaveRequestSchema,
  })
  @RequirePermission(APPROVE, 'team')
  approve(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(leaveDecisionSchema)) body: { note?: string },
  ) {
    return this.leave.decide(req, access, params.id, 'approved', body.note);
  }

  @Post('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Reject with a reason',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: leaveIdParamSchema,
    body: leaveReasonSchema,
    response: leaveRequestSchema,
  })
  @RequirePermission(APPROVE, 'team')
  reject(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(leaveReasonSchema)) body: { note: string },
  ) {
    return this.leave.decide(req, access, params.id, 'rejected', body.note);
  }

  @Post('requests/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Withdraw my pending request',
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    params: leaveIdParamSchema,
    response: leaveRequestSchema,
  })
  @RequirePermission(APPLY, 'own')
  withdraw(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.leave.withdraw(req, access, params.id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Cancel approved leave (balance restored once)',
    auth: 'member',
    permission: APPLY,
    companyHost: true,
    params: leaveIdParamSchema,
    body: leaveDecisionSchema,
    response: leaveRequestSchema,
  })
  @RequirePermission(APPLY, 'own')
  cancel(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(leaveDecisionSchema)) body: { note?: string },
  ) {
    return this.leave.cancel(req, access, params.id, body.note);
  }

  @Get('calendar')
  @ApiContract({
    summary: 'Approved and pending leave plus holidays (people I may see)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: leaveCalendarQuerySchema,
    response: leaveCalendarSchema,
  })
  @RequirePermission(READ, 'own')
  calendar(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(leaveCalendarQuerySchema)) query: { from: string; to: string },
  ) {
    return this.leave.calendar(access, query.from, query.to);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, NotifierModule],
  controllers: [LeaveController],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}
