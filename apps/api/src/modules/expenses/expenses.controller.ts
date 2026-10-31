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
  createExpenseRequestSchema,
  expenseClaimSchema,
  expenseDecisionSchema,
  expenseIdParamSchema,
  expenseLineParamSchema,
  expenseListQuerySchema,
  expenseListResponseSchema,
  expenseReimburseSchema,
  expenseRejectSchema,
  expenseSettingsSchema,
  fileDownloadResponseSchema,
  okResponseSchema,
  projectExpensesSchema,
  projectIdParamSchema,
  updateExpenseRequestSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { ObjectStorage } from '../../platform/files/object-storage.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { NotifierModule } from '../../platform/notifications/notifier.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ExpensesService } from './expenses.service.js';

type Id = { id: string };
const idPipe = new ZodValidationPipe(expenseIdParamSchema);
const CLAIM = 'expenses.claim.create';
const APPROVE = 'expenses.claim.approve';
const REIMBURSE = 'expenses.claim.reimburse';
const SETTINGS = 'expenses.settings.manage';
const settingsUpdateSchema = expenseSettingsSchema.partial().strict();

/** Expenses (docs/modules/expenses.md). Team scope and "not my own" are checked in the service. */
@Controller('expenses')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('settings')
  @ApiContract({
    summary: 'Expense categories and the receipt threshold',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    response: expenseSettingsSchema,
  })
  @RequirePermission(CLAIM, 'own')
  settings(@CurrentAccess() access: AccessContext) {
    return this.expenses.settings(access);
  }

  @Patch('settings')
  @ApiContract({
    summary: 'Change categories or the receipt threshold',
    auth: 'member',
    permission: SETTINGS,
    companyHost: true,
    body: settingsUpdateSchema,
    response: expenseSettingsSchema,
  })
  @RequirePermission(SETTINGS)
  updateSettings(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(settingsUpdateSchema)) body: z.output<typeof settingsUpdateSchema>,
  ) {
    return this.expenses.updateSettings(req, access, body);
  }

  @Get()
  @ApiContract({
    summary: 'My claims, claims waiting for my decision or reimbursement, or all I may see',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    query: expenseListQuerySchema,
    response: expenseListResponseSchema,
  })
  @RequirePermission(CLAIM, 'own')
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(expenseListQuerySchema))
    query: z.output<typeof expenseListQuerySchema>,
  ) {
    return this.expenses.list(access, query);
  }

  @Post()
  @ApiContract({
    summary: 'Start a claim (draft)',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    body: createExpenseRequestSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(CLAIM, 'own')
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createExpenseRequestSchema))
    body: z.output<typeof createExpenseRequestSchema>,
  ) {
    return this.expenses.create(req, access, body);
  }

  @Get(':id')
  @ApiContract({
    summary: 'One claim with its lines',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    params: expenseIdParamSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(CLAIM, 'own')
  get(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.expenses.get(access, params.id);
  }

  @Patch(':id')
  @ApiContract({
    summary: 'Edit my draft (lines are replaced)',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    params: expenseIdParamSchema,
    body: updateExpenseRequestSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(CLAIM, 'own')
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(updateExpenseRequestSchema))
    body: z.output<typeof updateExpenseRequestSchema>,
  ) {
    return this.expenses.update(req, access, params.id, body);
  }

  @Delete(':id')
  @ApiContract({
    summary: 'Delete my draft',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    params: expenseIdParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(CLAIM, 'own')
  async remove(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
  ) {
    await this.expenses.remove(req, access, params.id);
    return { status: 'ok' } as const;
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Submit for approval (number given on first submission)',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    params: expenseIdParamSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(CLAIM, 'own')
  submit(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.expenses.submit(req, access, params.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Approve (never my own)',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: expenseIdParamSchema,
    body: expenseDecisionSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(APPROVE, 'team')
  approve(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(expenseDecisionSchema)) body: { note?: string },
  ) {
    return this.expenses.decide(req, access, params.id, 'approved', body.note);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Reject with a reason',
    auth: 'member',
    permission: APPROVE,
    companyHost: true,
    params: expenseIdParamSchema,
    body: expenseRejectSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(APPROVE, 'team')
  reject(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(expenseRejectSchema)) body: { note: string },
  ) {
    return this.expenses.decide(req, access, params.id, 'rejected', body.note);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Reopen my rejected claim as a draft',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    params: expenseIdParamSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(CLAIM, 'own')
  reopen(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.expenses.reopen(req, access, params.id);
  }

  @Post(':id/reimburse')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Record the reimbursement of an approved claim (final)',
    auth: 'member',
    permission: REIMBURSE,
    companyHost: true,
    params: expenseIdParamSchema,
    body: expenseReimburseSchema,
    response: expenseClaimSchema,
  })
  @RequirePermission(REIMBURSE)
  reimburse(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(expenseReimburseSchema))
    body: z.output<typeof expenseReimburseSchema>,
  ) {
    return this.expenses.reimburse(req, access, params.id, body);
  }

  @Post(':id/lines/:lineId/receipt')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: '5-minute signed link to a clean receipt',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    params: expenseLineParamSchema,
    response: fileDownloadResponseSchema,
  })
  @RequirePermission(CLAIM, 'own')
  receipt(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(expenseLineParamSchema)) params: { id: string; lineId: string },
  ) {
    return this.expenses.receiptDownload(req, access, params.id, params.lineId);
  }
}

/** A project's expense cost, next to its other project routes. */
@Controller('projects')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class ProjectExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get(':id/expenses')
  @ApiContract({
    summary: 'Expenses charged to a project (company expense readers, or its manager)',
    auth: 'member',
    permission: CLAIM,
    companyHost: true,
    params: projectIdParamSchema,
    response: projectExpensesSchema,
  })
  @RequirePermission(CLAIM, 'own')
  forProject(
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(projectIdParamSchema)) params: Id,
  ) {
    return this.expenses.forProject(access, params.id);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, NotifierModule],
  controllers: [ExpensesController, ProjectExpensesController],
  providers: [ExpensesService, ObjectStorage],
  exports: [ExpensesService],
})
export class ExpensesModule {}
