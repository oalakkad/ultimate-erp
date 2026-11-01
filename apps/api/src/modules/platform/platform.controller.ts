import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  platformAuditListResponseSchema,
  platformCompanyIdParamSchema,
  platformCompanyListQuerySchema,
  platformCompanyListResponseSchema,
  platformCompanySchema,
  platformCompanyStatusRequestSchema,
  platformMeResponseSchema,
  platformOverviewSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { IdentityModule } from '../identity/identity.module.js';
import { type Identity } from '../identity/identity.service.js';
import { CurrentIdentity, SessionGuard } from '../identity/session.guard.js';
import { CurrentOperator, type Operator, PlatformGuard } from './platform.guard.js';
import { PlatformService } from './platform.service.js';

type Id = z.infer<typeof platformCompanyIdParamSchema>;

/** The founder's console: every company using this installation (docs/modules/platform.md). */
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('me')
  @ApiContract({
    summary: 'Whether I may open the platform console',
    auth: 'session',
    response: platformMeResponseSchema,
  })
  @UseGuards(SessionGuard)
  async me(@Req() req: Request, @CurrentIdentity() identity: Identity) {
    return {
      founder:
        !(await this.platform.isCompanyHost(req.hostname)) &&
        (await this.platform.isOperator(identity.userId)),
    };
  }

  @Get('overview')
  @ApiContract({
    summary: 'Installation-wide numbers',
    auth: 'session',
    response: platformOverviewSchema,
  })
  @UseGuards(PlatformGuard)
  overview(@CurrentOperator() operator: Operator) {
    return this.platform.overview(operator.userId);
  }

  @Get('companies')
  @ApiContract({
    summary: 'Every company: identity, size, activity (no business data)',
    auth: 'session',
    query: platformCompanyListQuerySchema,
    response: platformCompanyListResponseSchema,
  })
  @UseGuards(PlatformGuard)
  async companies(
    @CurrentOperator() operator: Operator,
    @Query(new ZodValidationPipe(platformCompanyListQuerySchema))
    query: z.infer<typeof platformCompanyListQuerySchema>,
  ) {
    return { items: await this.platform.companies(operator.userId, query) };
  }

  @Get('companies/:id')
  @ApiContract({
    summary: 'One company',
    auth: 'session',
    params: platformCompanyIdParamSchema,
    response: platformCompanySchema,
  })
  @UseGuards(PlatformGuard)
  company(
    @CurrentOperator() operator: Operator,
    @Param(new ZodValidationPipe(platformCompanyIdParamSchema)) params: Id,
  ) {
    return this.platform.company(operator.userId, params.id);
  }

  @Post('companies/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Suspend or reactivate a company (reason recorded in the platform audit)',
    auth: 'session',
    params: platformCompanyIdParamSchema,
    body: platformCompanyStatusRequestSchema,
    response: platformCompanySchema,
  })
  @UseGuards(PlatformGuard)
  setStatus(
    @Req() req: Request,
    @CurrentOperator() operator: Operator,
    @Param(new ZodValidationPipe(platformCompanyIdParamSchema)) params: Id,
    @Body(new ZodValidationPipe(platformCompanyStatusRequestSchema))
    body: z.infer<typeof platformCompanyStatusRequestSchema>,
  ) {
    return this.platform.setStatus(req, operator.userId, params.id, body);
  }

  @Get('audit-events')
  @ApiContract({
    summary: "The founders' own actions, newest first",
    auth: 'session',
    response: platformAuditListResponseSchema,
  })
  @UseGuards(PlatformGuard)
  async audit(@CurrentOperator() operator: Operator) {
    return { items: await this.platform.auditEvents(operator.userId) };
  }
}

@Module({
  imports: [IdentityModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformGuard],
})
export class PlatformModule {}
