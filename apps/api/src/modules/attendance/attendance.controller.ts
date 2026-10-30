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
  attendanceIdParamSchema,
  attendanceSettingsSchema,
  attendanceSettingsUpdateSchema,
  attendanceSummaryQuerySchema,
  attendanceSummarySchema,
  attendanceTodaySchema,
  checkRequestSchema,
  correctionDecisionSchema,
  correctionListQuerySchema,
  correctionListResponseSchema,
  correctionRequestSchema,
  correctionSchema,
  kioskCodeSchema,
  membershipParamSchema,
  myAttendanceSchema,
  shiftAssignmentSchema,
  shiftListResponseSchema,
  shiftRequestSchema,
  shiftUpdateSchema,
  siteListResponseSchema,
  siteRequestSchema,
  siteUpdateSchema,
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
import { AttendanceService, KioskCodes } from './attendance.service.js';

type Id = { id: string };
const idPipe = new ZodValidationPipe(attendanceIdParamSchema);
const CHECK = 'attendance.check';
const READ = 'attendance.read';
const APPROVE = 'attendance.correction.approve';
const MANAGE = 'attendance.manage';

/** Attendance (docs/modules/attendance.md). */
@Controller('attendance')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('settings')
  @ApiContract({
    summary: 'Attendance settings',
    auth: 'member',
    permission: CHECK,
    companyHost: true,
    response: attendanceSettingsSchema,
  })
  @RequirePermission(CHECK, 'own')
  settings(@CurrentAccess() access: AccessContext) {
    return this.attendance.settings(access);
  }

  @Patch('settings')
  @ApiContract({
    summary: 'Change attendance settings',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    body: attendanceSettingsUpdateSchema,
    response: attendanceSettingsSchema,
  })
  @RequirePermission(MANAGE)
  updateSettings(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(attendanceSettingsUpdateSchema))
    body: z.output<typeof attendanceSettingsUpdateSchema>,
  ) {
    return this.attendance.updateSettings(req, access, body);
  }

  @Get('sites')
  @ApiContract({
    summary: 'Attendance sites (kiosks)',
    auth: 'member',
    permission: CHECK,
    companyHost: true,
    response: siteListResponseSchema,
  })
  @RequirePermission(CHECK, 'own')
  sites(@CurrentAccess() access: AccessContext) {
    return this.attendance.sites(access);
  }

  @Post('sites')
  @ApiContract({
    summary: 'Add a site',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    body: siteRequestSchema,
    response: siteListResponseSchema,
  })
  @RequirePermission(MANAGE)
  createSite(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(siteRequestSchema)) body: { nameEn: string; nameAr: string },
  ) {
    return this.attendance.saveSite(req, access, null, body);
  }

  @Patch('sites/:id')
  @ApiContract({
    summary: 'Rename or archive a site',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: attendanceIdParamSchema,
    body: siteUpdateSchema,
    response: siteListResponseSchema,
  })
  @RequirePermission(MANAGE)
  updateSite(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(siteUpdateSchema)) body: z.output<typeof siteUpdateSchema>,
  ) {
    return this.attendance.saveSite(req, access, params.id, body);
  }

  @Get('sites/:id/code')
  @ApiContract({
    summary: "The kiosk's current rotating code",
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: attendanceIdParamSchema,
    response: kioskCodeSchema,
  })
  @RequirePermission(MANAGE)
  code(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.attendance.kioskCode(access, params.id);
  }

  @Get('shifts')
  @ApiContract({
    summary: 'Shifts and who works them',
    auth: 'member',
    permission: CHECK,
    companyHost: true,
    response: shiftListResponseSchema,
  })
  @RequirePermission(CHECK, 'own')
  shifts(@CurrentAccess() access: AccessContext) {
    return this.attendance.shiftList(access);
  }

  @Post('shifts')
  @ApiContract({
    summary: 'Add a shift',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    body: shiftRequestSchema,
    response: shiftListResponseSchema,
  })
  @RequirePermission(MANAGE)
  createShift(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(shiftRequestSchema)) body: z.output<typeof shiftRequestSchema>,
  ) {
    return this.attendance.saveShift(req, access, null, body);
  }

  @Patch('shifts/:id')
  @ApiContract({
    summary: 'Edit or archive a shift',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: attendanceIdParamSchema,
    body: shiftUpdateSchema,
    response: shiftListResponseSchema,
  })
  @RequirePermission(MANAGE)
  updateShift(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(shiftUpdateSchema)) body: z.output<typeof shiftUpdateSchema>,
  ) {
    return this.attendance.saveShift(req, access, params.id, body);
  }

  @Put('assignments/:id')
  @ApiContract({
    summary: 'Assign a person to a shift (or none)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: membershipParamSchema,
    body: shiftAssignmentSchema,
    response: shiftListResponseSchema,
  })
  @RequirePermission(MANAGE)
  assign(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(membershipParamSchema)) params: Id,
    @Body(new ZodValidationPipe(shiftAssignmentSchema)) body: { shiftId: string | null },
  ) {
    return this.attendance.assign(req, access, params.id, body.shiftId);
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: "Check in or out (kiosk code, or web if allowed); time is the server's",
    auth: 'member',
    permission: CHECK,
    companyHost: true,
    body: checkRequestSchema,
    response: myAttendanceSchema,
  })
  @RequirePermission(CHECK, 'own')
  check(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(checkRequestSchema)) body: { code?: string },
  ) {
    return this.attendance.check(req, access, body.code);
  }

  @Get('me')
  @ApiContract({
    summary: 'My attendance today',
    auth: 'member',
    permission: CHECK,
    companyHost: true,
    response: myAttendanceSchema,
  })
  @RequirePermission(CHECK, 'own')
  me(@CurrentAccess() access: AccessContext) {
    return this.attendance.me(access);
  }

  @Get('summary')
  @ApiContract({
    summary: 'Days of a period: present, late, early, absent, leave; worked vs logged',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: attendanceSummaryQuerySchema,
    response: attendanceSummarySchema,
  })
  @RequirePermission(READ, 'own')
  summary(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(attendanceSummaryQuerySchema))
    query: z.output<typeof attendanceSummaryQuerySchema>,
  ) {
    return this.attendance.summary(access, query.from, query.to, query.membershipId);
  }

  @Get('today')
  @ApiContract({
    summary: 'Who is in today (people I may see)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: attendanceTodaySchema,
  })
  @RequirePermission(READ, 'own')
  today(@CurrentAccess() access: AccessContext) {
    return this.attendance.today(access);
  }

  @Get('corrections')
  @ApiContract({
    summary: 'My corrections, or those waiting for me',
    auth: 'member',
    permission: CHECK,
    companyHost: true,
    query: correctionListQuerySchema,
    response: correctionListResponseSchema,
  })
  @RequirePermission(CHECK, 'own')
  corrections(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(correctionListQuerySchema)) query: { view: 'mine' | 'approvals' },
  ) {
    return this.attendance.corrections(access, query.view);
  }

  @Post('corrections')
  @ApiContract({
    summary: 'Ask for a missing check-in or check-out to be added',
    auth: 'member',
    permission: CHECK,
    companyHost: true,
    body: correctionRequestSchema,
    response: correctionSchema,
  })
  @RequirePermission(CHECK, 'own')
  requestCorrection(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(correctionRequestSchema))
    body: { kind: 'in' | 'out'; at: string; reason: string },
  ) {
    return this.attendance.requestCorrection(req, access, body);
  }

  @Post('corrections/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Approve a correction (adds a manual event)',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: attendanceIdParamSchema,
    body: correctionDecisionSchema,
    response: correctionSchema,
  })
  @RequirePermission(APPROVE, 'team')
  approve(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(correctionDecisionSchema)) body: { note?: string },
  ) {
    return this.attendance.decide(req, access, params.id, 'approved', body.note);
  }

  @Post('corrections/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Reject a correction with a note',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: attendanceIdParamSchema,
    body: correctionDecisionSchema,
    response: correctionSchema,
  })
  @RequirePermission(APPROVE, 'team')
  reject(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(correctionDecisionSchema)) body: { note?: string },
  ) {
    return this.attendance.decide(req, access, params.id, 'rejected', body.note);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, NotifierModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, KioskCodes],
  exports: [AttendanceService],
})
export class AttendanceModule {}
