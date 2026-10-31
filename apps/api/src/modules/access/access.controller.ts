import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  accessMeResponseSchema,
  auditSearchQuerySchema,
  auditListResponseSchema,
  memberListResponseSchema,
  membershipIdParamSchema,
  okResponseSchema,
  setRolesRequestSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { z } from 'zod';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import {
  type AccessContext,
  AllowWithoutMfa,
  CurrentAccess,
  RequirePermission,
} from './access-context.js';
import { AccessGuard } from './access.guard.js';
import { AccessService } from './access.service.js';
import { AuditEventsService } from './audit-events.service.js';

/** Company members, roles and audit trail. Every route: member of this company + permission. */
@Controller()
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  /** My roles and permissions here — also answers "do I need to set up two-factor?". */
  @Get('access/me')
  @ApiContract({
    summary: 'My roles and permissions in this company',
    auth: 'member',
    companyHost: true,
    response: accessMeResponseSchema,
  })
  @AllowWithoutMfa()
  me(@CurrentAccess() access: AccessContext) {
    return this.access.me(access);
  }

  @Get('members')
  @ApiContract({
    summary: 'Company members',
    auth: 'member',
    permission: 'access.members.read',
    companyHost: true,
    response: memberListResponseSchema,
  })
  @RequirePermission('access.members.read')
  async listMembers(@CurrentAccess() access: AccessContext) {
    return { members: await this.access.listMembers(access) };
  }

  @Put('members/:id/roles')
  @ApiContract({
    summary: "Replace a member's roles",
    auth: 'member',
    permission: 'access.roles.assign',
    companyHost: true,
    params: membershipIdParamSchema,
    body: setRolesRequestSchema,
    response: okResponseSchema,
  })
  @RequirePermission('access.roles.assign')
  async setRoles(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(membershipIdParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(setRolesRequestSchema)) body: z.infer<typeof setRolesRequestSchema>,
  ) {
    await this.access.setRoles(req, access, params.id, body.roles);
    return { status: 'ok' } as const;
  }

  @Post('members/:id/remove')
  @ApiContract({
    summary: 'Remove a member (history kept)',
    auth: 'member',
    permission: 'access.members.manage',
    companyHost: true,
    params: membershipIdParamSchema,
    response: okResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('access.members.manage')
  async removeMember(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(membershipIdParamSchema)) params: { id: string },
  ) {
    await this.access.removeMember(req, access, params.id);
    return { status: 'ok' } as const;
  }

  @Get('audit-events')
  @ApiContract({
    summary: 'Audit trail, newest first, with filters',
    auth: 'member',
    permission: 'audit.event.read',
    companyHost: true,
    query: auditSearchQuerySchema,
    response: auditListResponseSchema,
  })
  @RequirePermission('audit.event.read')
  listAuditEvents(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(auditSearchQuerySchema))
    query: z.output<typeof auditSearchQuerySchema>,
  ) {
    return this.auditEvents.list(access, query);
  }

  @Get('audit-events/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  @ApiContract({
    summary: 'Export the filtered audit trail as CSV (audited)',
    auth: 'member',
    permission: 'audit.event.read',
    companyHost: true,
    query: auditSearchQuerySchema,
    response: z.string(),
  })
  @RequirePermission('audit.event.read')
  exportAuditEvents(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(auditSearchQuerySchema))
    query: z.output<typeof auditSearchQuerySchema>,
  ) {
    return this.auditEvents.exportCsv(req, access, query);
  }
}
