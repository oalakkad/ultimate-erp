import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  invitationListResponseSchema,
  invitationPreviewResponseSchema,
  invitationSchema,
  invitationTokenQuerySchema,
  membershipIdParamSchema,
  okResponseSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type Identity } from '../identity/identity.service.js';
import { CurrentIdentity, SessionGuard } from '../identity/session.guard.js';
import { CurrentTenant, type TenantContext } from '../tenancy/tenant-context.js';
import { type AccessContext, CurrentAccess, RequirePermission } from './access-context.js';
import { AccessGuard } from './access.guard.js';
import { InvitationsService } from './invitations.service.js';

@Controller('invitations')
@UseInterceptors(NoStoreInterceptor)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @ApiContract({
    summary: 'Invite someone by email with a role',
    auth: 'member',
    permission: 'access.members.invite',
    companyHost: true,
    body: createInvitationRequestSchema,
    response: invitationSchema,
    status: 201,
  })
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AccessGuard)
  @RequirePermission('access.members.invite')
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createInvitationRequestSchema))
    body: z.infer<typeof createInvitationRequestSchema>,
  ) {
    return this.invitations.create(req, access, body.email, body.role);
  }

  @Get()
  @ApiContract({
    summary: 'Pending invitations',
    auth: 'member',
    permission: 'access.members.invite',
    companyHost: true,
    response: invitationListResponseSchema,
  })
  @UseGuards(AccessGuard)
  @RequirePermission('access.members.invite')
  async list(@CurrentAccess() access: AccessContext) {
    return { invitations: await this.invitations.listPending(access) };
  }

  @Delete(':id')
  @ApiContract({
    summary: 'Revoke an invitation',
    auth: 'member',
    permission: 'access.members.invite',
    companyHost: true,
    params: membershipIdParamSchema,
    response: okResponseSchema,
  })
  @UseGuards(AccessGuard)
  @RequirePermission('access.members.invite')
  async revoke(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(membershipIdParamSchema)) params: { id: string },
  ) {
    await this.invitations.revoke(req, access, params.id);
    return { status: 'ok' } as const;
  }

  /** Public: what the link is about. Shows a masked email only. */
  @Get('preview')
  @ApiContract({
    summary: 'What an invitation link is about (email masked)',
    auth: 'public',
    companyHost: true,
    query: invitationTokenQuerySchema,
    response: invitationPreviewResponseSchema,
  })
  preview(
    @Req() req: Request,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(invitationTokenQuerySchema)) query: { token: string },
  ) {
    return this.invitations.preview(req, tenant.tenantId, query.token);
  }

  /** Signed in (any account), not yet a member: the invitation itself is the authorization. */
  @Post('accept')
  @ApiContract({
    summary: 'Accept an invitation with the signed-in account',
    auth: 'session',
    companyHost: true,
    body: acceptInvitationRequestSchema,
    response: okResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  accept(
    @Req() req: Request,
    @CurrentTenant() tenant: TenantContext,
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: { token: string },
  ) {
    return this.invitations.accept(req, tenant.tenantId, identity, body.token);
  }
}
