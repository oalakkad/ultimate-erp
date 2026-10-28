import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  backupCodeRequestSchema,
  backupCodesResponseSchema,
  okResponseSchema,
  passwordConfirmRequestSchema,
  type SignInResponse,
  signInResponseSchema,
  twoFactorConfirmRequestSchema,
  twoFactorSetupResponseSchema,
  twoFactorVerifyRequestSchema,
} from '@ultimate-erp/contracts';
import { type Request, type Response } from 'express';
import { type z } from 'zod';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type Identity, IdentityService } from './identity.service.js';
import { CurrentIdentity, SessionGuard } from './session.guard.js';

/** Two-factor sign-in steps (no session yet) and management (signed in). */
@Controller('auth/two-factor')
@UseInterceptors(NoStoreInterceptor)
export class TwoFactorController {
  constructor(private readonly identity: IdentityService) {}

  @Post('verify')
  @ApiContract({
    summary: 'Complete sign-in with an authenticator code',
    auth: 'public',
    body: twoFactorVerifyRequestSchema,
    response: signInResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  verify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(twoFactorVerifyRequestSchema))
    body: z.infer<typeof twoFactorVerifyRequestSchema>,
  ): Promise<SignInResponse> {
    return this.identity.verifyTotp(req, res, body);
  }

  @Post('verify-backup-code')
  @ApiContract({
    summary: 'Complete sign-in with a backup code',
    auth: 'public',
    body: backupCodeRequestSchema,
    response: signInResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  verifyBackupCode(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(backupCodeRequestSchema))
    body: z.infer<typeof backupCodeRequestSchema>,
  ): Promise<SignInResponse> {
    return this.identity.verifyBackupCode(req, res, body);
  }

  @Post('enable')
  @ApiContract({
    summary: 'Start two-factor setup (password required)',
    auth: 'session',
    body: passwordConfirmRequestSchema,
    response: twoFactorSetupResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  enable(
    @Req() req: Request,
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(passwordConfirmRequestSchema)) body: { password: string },
  ) {
    return this.identity.enableTwoFactor(req, identity, body.password);
  }

  @Post('confirm')
  @ApiContract({
    summary: 'Activate two-factor with the first code',
    auth: 'session',
    body: twoFactorConfirmRequestSchema,
    response: okResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async confirm(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(twoFactorConfirmRequestSchema)) body: { code: string },
  ) {
    await this.identity.confirmTwoFactor(req, res, identity, body.code);
    return { status: 'ok' } as const;
  }

  @Post('disable')
  @ApiContract({
    summary: 'Turn two-factor off (password required)',
    auth: 'session',
    body: passwordConfirmRequestSchema,
    response: okResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async disable(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(passwordConfirmRequestSchema)) body: { password: string },
  ) {
    await this.identity.disableTwoFactor(req, res, identity, body.password);
    return { status: 'ok' } as const;
  }

  @Post('backup-codes')
  @ApiContract({
    summary: 'Replace backup codes (password required)',
    auth: 'session',
    body: passwordConfirmRequestSchema,
    response: backupCodesResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  regenerateBackupCodes(
    @Req() req: Request,
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(passwordConfirmRequestSchema)) body: { password: string },
  ) {
    return this.identity.regenerateBackupCodes(req, identity, body.password);
  }
}
