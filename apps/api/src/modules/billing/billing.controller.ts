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
  agingSchema,
  billingIdParamSchema,
  billingSettingsSchema,
  billingSettingsUpdateSchema,
  createInvoiceRequestSchema,
  creditNoteRequestSchema,
  invoiceFromTimeRequestSchema,
  invoiceListQuerySchema,
  invoiceListResponseSchema,
  invoiceSchema,
  issueInvoiceRequestSchema,
  okResponseSchema,
  paymentRequestSchema,
  revenueQuerySchema,
  revenueSchema,
  reversePaymentRequestSchema,
  updateInvoiceRequestSchema,
  voidInvoiceRequestSchema,
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
import { BillingService } from './billing.service.js';

type Id = { id: string };
const idPipe = new ZodValidationPipe(billingIdParamSchema);
const READ = 'billing.invoice.read';
const ISSUE = 'billing.invoice.issue';
const PAY = 'billing.payment.record';

/** Invoicing & payments (docs/modules/billing.md). */
@Controller()
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing/settings')
  @ApiContract({
    summary: 'Payment terms and taxes',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: billingSettingsSchema,
  })
  @RequirePermission(READ, 'project')
  settings(@CurrentAccess() access: AccessContext) {
    return this.billing.settings(access);
  }

  @Patch('billing/settings')
  @ApiContract({
    summary: 'Change payment terms and taxes',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    body: billingSettingsUpdateSchema,
    response: billingSettingsSchema,
  })
  @RequirePermission(ISSUE)
  updateSettings(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(billingSettingsUpdateSchema))
    body: z.output<typeof billingSettingsUpdateSchema>,
  ) {
    return this.billing.updateSettings(req, access, body);
  }

  @Get('invoices')
  @ApiContract({
    summary: 'Invoices I may see',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: invoiceListQuerySchema,
    response: invoiceListResponseSchema,
  })
  @RequirePermission(READ, 'project')
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(invoiceListQuerySchema))
    query: z.output<typeof invoiceListQuerySchema>,
  ) {
    return this.billing.list(access, query);
  }

  @Post('invoices')
  @ApiContract({
    summary: 'Create a draft invoice',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    body: createInvoiceRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(ISSUE)
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createInvoiceRequestSchema))
    body: z.output<typeof createInvoiceRequestSchema>,
  ) {
    return this.billing.create(req, access, body);
  }

  @Post('invoices/from-time')
  @ApiContract({
    summary: 'Draft from approved, billable, not-yet-invoiced time of a project',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    body: invoiceFromTimeRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(ISSUE)
  fromTime(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(invoiceFromTimeRequestSchema))
    body: z.output<typeof invoiceFromTimeRequestSchema>,
  ) {
    return this.billing.fromTime(req, access, body);
  }

  @Get('invoices/:id')
  @ApiContract({
    summary: 'One invoice',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: billingIdParamSchema,
    response: invoiceSchema,
  })
  @RequirePermission(READ, 'project')
  get(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.billing.get(access, params.id);
  }

  @Patch('invoices/:id')
  @ApiContract({
    summary: 'Edit a draft (lines replaced)',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    params: billingIdParamSchema,
    body: updateInvoiceRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(ISSUE)
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(updateInvoiceRequestSchema))
    body: z.output<typeof updateInvoiceRequestSchema>,
  ) {
    return this.billing.update(req, access, params.id, body);
  }

  @Delete('invoices/:id')
  @ApiContract({
    summary: 'Delete a draft (issued invoices are never deleted)',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    params: billingIdParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(ISSUE)
  async remove(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
  ) {
    await this.billing.remove(req, access, params.id);
    return { status: 'ok' } as const;
  }

  @Post('invoices/:id/issue')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Issue (number and dates assigned)',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    params: billingIdParamSchema,
    body: issueInvoiceRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(ISSUE)
  issue(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(issueInvoiceRequestSchema))
    body: z.output<typeof issueInvoiceRequestSchema>,
  ) {
    return this.billing.issue(req, access, params.id, body);
  }

  @Post('invoices/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Void an issued invoice without payments (reason required)',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    params: billingIdParamSchema,
    body: voidInvoiceRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(ISSUE)
  voidInvoice(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(voidInvoiceRequestSchema)) body: { reason: string },
  ) {
    return this.billing.void(req, access, params.id, body.reason);
  }

  @Post('invoices/:id/payments')
  @ApiContract({
    summary: 'Record a payment (recorded, not provider-confirmed)',
    auth: 'member',
    permission: PAY,
    companyHost: true,
    params: billingIdParamSchema,
    body: paymentRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(PAY)
  pay(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(paymentRequestSchema)) body: z.output<typeof paymentRequestSchema>,
  ) {
    return this.billing.recordPayment(req, access, params.id, body);
  }

  @Post('payments/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Reverse a recorded payment (reason required)',
    auth: 'member',
    permission: PAY,
    companyHost: true,
    params: billingIdParamSchema,
    body: reversePaymentRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(PAY)
  reverse(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(reversePaymentRequestSchema)) body: { reason: string },
  ) {
    return this.billing.reversePayment(req, access, params.id, body.reason);
  }

  @Post('invoices/:id/credit-notes')
  @ApiContract({
    summary: 'Issue a credit note against an open invoice',
    auth: 'member',
    permission: ISSUE,
    companyHost: true,
    params: billingIdParamSchema,
    body: creditNoteRequestSchema,
    response: invoiceSchema,
  })
  @RequirePermission(ISSUE)
  credit(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(creditNoteRequestSchema)) body: { amount: string; reason: string },
  ) {
    return this.billing.creditNote(req, access, params.id, body);
  }

  @Get('billing/aging')
  @ApiContract({
    summary: 'Receivables by age bucket and client',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: agingSchema,
  })
  @RequirePermission(READ)
  aging(@CurrentAccess() access: AccessContext) {
    return this.billing.aging(access);
  }

  @Get('billing/revenue')
  @ApiContract({
    summary: 'Invoiced and received by month',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: revenueQuerySchema,
    response: revenueSchema,
  })
  @RequirePermission(READ)
  revenue(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(revenueQuerySchema)) query: { year: number },
  ) {
    return this.billing.revenue(access, query.year);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, NotifierModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
