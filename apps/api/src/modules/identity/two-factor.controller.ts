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
  passwordConfirmRequestSchema,
  twoFactorConfirmRequestSchema,
  twoFactorVerifyRequestSchema,
  type SignInResponse,
} from '@ultimate-erp/contracts';
import { type Request, type Response } from 'express';
import { type z } from 'zod';
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
