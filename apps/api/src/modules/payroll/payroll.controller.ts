import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  newRuleSetRequestSchema,
  newRunRequestSchema,
  payrollIdParamSchema,
  payrollRunListResponseSchema,
  payrollRunSchema,
  payslipListResponseSchema,
  payslipSchema,
  ruleSetListResponseSchema,
  salaryListQuerySchema,
  salaryListResponseSchema,
  salaryRequestSchema,
  setInputsRequestSchema,
  verifyRuleSetRequestSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { z } from 'zod';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { NotifierModule } from '../../platform/notifications/notifier.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { AttendanceModule } from '../attendance/attendance.controller.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PayrollService } from './payroll.service.js';
import { Limit, ROUTE_LIMITS } from '../../platform/rate-limit/route-limit.js';

type Id = { id: string };
const idPipe = new ZodValidationPipe(payrollIdParamSchema);
const PREPARE = 'payroll.run.prepare';
const APPROVE = 'payroll.run.approve';
const READ = 'payroll.payslip.read';

/**
 * Payroll (docs/modules/payroll.md). Every route needs a payroll permission; the service checks
 * the exact one (prepare / approve / read) and separation of duties.
 */
@Controller('payroll')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('rules')
  @ApiContract({
    summary: 'Payroll rule versions (newest first)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: ruleSetListResponseSchema,
  })
  @RequirePermission(READ)
  rules(@CurrentAccess() access: AccessContext) {
    return this.payroll.ruleSets(access);
  }

  @Post('rules')
  @ApiContract({
    summary: 'Create a new rule version (starts "to be verified")',
    auth: 'member',
    permission: PREPARE,
    companyHost: true,
    body: newRuleSetRequestSchema,
    response: ruleSetListResponseSchema,
  })
  @RequirePermission(PREPARE)
  newRules(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(newRuleSetRequestSchema))
    body: z.output<typeof newRuleSetRequestSchema>,
  ) {
    return this.payroll.newRuleSet(req, access, body);
  }

  @Post('rules/:id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Confirm a Kuwaiti lawyer/accountant verified this version',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: payrollIdParamSchema,
    body: verifyRuleSetRequestSchema,
    response: ruleSetListResponseSchema,
  })
  @RequirePermission(APPROVE)
  verify(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(verifyRuleSetRequestSchema)) body: { note: string },
  ) {
    return this.payroll.verifyRuleSet(req, access, params.id, body.note);
  }

  @Get('salaries')
  @ApiContract({
    summary: 'Salary records (history; reads audited)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: salaryListQuerySchema,
    response: salaryListResponseSchema,
  })
  @RequirePermission(READ)
  salaries(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(salaryListQuerySchema)) query: { membershipId?: string },
  ) {
    return this.payroll.salaries(req, access, query.membershipId);
  }

  @Post('salaries')
  @ApiContract({
    summary: 'Record a salary from a date (history kept)',
    auth: 'member',
    permission: PREPARE,
    companyHost: true,
    body: salaryRequestSchema,
    response: salaryListResponseSchema,
  })
  @RequirePermission(PREPARE)
  addSalary(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(salaryRequestSchema)) body: z.output<typeof salaryRequestSchema>,
  ) {
    return this.payroll.addSalary(req, access, body);
  }

  @Get('runs')
  @ApiContract({
    summary: 'Payroll runs',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: payrollRunListResponseSchema,
  })
  @RequirePermission(READ)
  runs(@CurrentAccess() access: AccessContext) {
    return this.payroll.runs(access);
  }

  @Post('runs')
  @ApiContract({
    summary: 'Start the run of a month (one per month)',
    auth: 'member',
    permission: PREPARE,
    companyHost: true,
    body: newRunRequestSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(PREPARE)
  createRun(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(newRunRequestSchema)) body: { period: string },
  ) {
    return this.payroll.createRun(req, access, body.period);
  }

  @Get('runs/:id')
  @ApiContract({
    summary: 'A run with payslips, totals and warnings (view audited)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: payrollIdParamSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(READ)
  run(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.payroll.run(req, access, params.id);
  }

  @Put('runs/:id/inputs')
  @ApiContract({
    summary: "Replace the month's explicit inputs (overtime hours, bonuses, advances, adjustments)",
    auth: 'member',
    permission: PREPARE,
    companyHost: true,
    params: payrollIdParamSchema,
    body: setInputsRequestSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(PREPARE)
  setInputs(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(setInputsRequestSchema))
    body: z.output<typeof setInputsRequestSchema>,
  ) {
    return this.payroll.setInputs(req, access, params.id, body.inputs);
  }

  @Post('runs/:id/calculate')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Calculate (or recalculate) all payslips',
    auth: 'member',
    permission: PREPARE,
    companyHost: true,
    params: payrollIdParamSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(PREPARE)
  calculate(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
  ) {
    return this.payroll.calculate(req, access, params.id);
  }

  @Post('runs/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Submit for approval',
    auth: 'member',
    permission: PREPARE,
    companyHost: true,
    params: payrollIdParamSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(PREPARE)
  submit(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.payroll.transition(req, access, params.id, 'submit');
  }

  @Post('runs/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Approve (never the preparer); payslips become visible',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: payrollIdParamSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(APPROVE)
  approve(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.payroll.transition(req, access, params.id, 'approve');
  }

  @Post('runs/:id/pay')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Mark paid (never the preparer; verified rules only; once)',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: payrollIdParamSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(APPROVE)
  pay(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.payroll.transition(req, access, params.id, 'pay');
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Cancel a run that is not approved yet',
    auth: 'member',
    permission: PREPARE,
    companyHost: true,
    params: payrollIdParamSchema,
    response: payrollRunSchema,
  })
  @RequirePermission(PREPARE)
  cancel(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.payroll.transition(req, access, params.id, 'cancel');
  }

  @Limit(ROUTE_LIMITS.export)
  @Get('runs/:id/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payroll.csv"')
  @ApiContract({
    summary: 'Export an approved run as CSV (audited)',
    auth: 'member',
    permission: 'exports.confidential',
    companyHost: true,
    params: payrollIdParamSchema,
    response: z.string(),
  })
  @RequirePermission('exports.confidential')
  async export(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
  ) {
    return (await this.payroll.export(req, access, params.id)).body;
  }

  @Get('payslips/mine')
  @ApiContract({
    summary: 'My approved payslips',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: payslipListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  mine(@CurrentAccess() access: AccessContext) {
    return this.payroll.myPayslips(access);
  }

  @Get('payslips/:id')
  @ApiContract({
    summary: 'One payslip (mine once approved, or payroll staff; view audited)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: payrollIdParamSchema,
    response: payslipSchema,
  })
  @RequirePermission(READ, 'own')
  payslip(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.payroll.payslip(req, access, params.id);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, NotifierModule, AttendanceModule],
  controllers: [PayrollController],
  providers: [PayrollService],
})
export class PayrollModule {}
