import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  okResponseSchema,
  sessionIdParamSchema,
  sessionListResponseSchema,
} from '@ultimate-erp/contracts';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type Identity, IdentityService } from './identity.service.js';
import { CurrentIdentity, SessionGuard } from './session.guard.js';

/** The signed-in user's own sessions ("where am I signed in?"). */
@Controller('auth/sessions')
@UseGuards(SessionGuard)
@UseInterceptors(NoStoreInterceptor)
export class SessionsController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  @ApiContract({
    summary: 'My active sessions (no tokens)',
    auth: 'session',
    response: sessionListResponseSchema,
  })
  async list(@CurrentIdentity() identity: Identity) {
    return { sessions: await this.identity.listSessions(identity) };
  }

  @Delete(':id')
  @ApiContract({
    summary: 'Revoke one of my sessions',
    auth: 'session',
    params: sessionIdParamSchema,
    response: okResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentIdentity() identity: Identity,
    @Param(new ZodValidationPipe(sessionIdParamSchema)) params: { id: string },
  ) {
    await this.identity.revokeSession(identity, params.id);
    return { status: 'ok' } as const;
  }

  @Post('revoke-others')
  @ApiContract({
    summary: 'Revoke all my other sessions',
    auth: 'session',
    response: okResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  async revokeOthers(@CurrentIdentity() identity: Identity) {
    await this.identity.revokeOtherSessions(identity);
    return { status: 'ok' } as const;
  }
}
