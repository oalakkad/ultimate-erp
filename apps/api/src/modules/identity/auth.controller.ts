import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  changePasswordRequestSchema,
  emailOnlyRequestSchema,
  resetPasswordRequestSchema,
  signInRequestSchema,
  signUpRequestSchema,
  verifyEmailQuerySchema,
  type SignInResponse,
} from '@ultimate-erp/contracts';
import { type Request, type Response } from 'express';
import { type z } from 'zod';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type Identity, IdentityService } from './identity.service.js';
import { CurrentIdentity, SessionGuard } from './session.guard.js';

const ACCEPTED = { status: 'accepted' } as const;
const OK = { status: 'ok' } as const;

/** Account lifecycle: sign-up, verification, sign-in/out, passwords. */
@Controller('auth')
@UseInterceptors(NoStoreInterceptor)
export class AuthController {
  constructor(private readonly identity: IdentityService) {}

  @Post('sign-up')
  @HttpCode(HttpStatus.ACCEPTED)
  async signUp(
    @Req() req: Request,
    @Body(new ZodValidationPipe(signUpRequestSchema)) body: z.infer<typeof signUpRequestSchema>,
  ) {
    await this.identity.signUp(req, body);
    return ACCEPTED;
  }

  @Get('verify-email')
  async verifyEmail(
    @Req() req: Request,
    @Query(new ZodValidationPipe(verifyEmailQuerySchema)) query: { token: string },
  ) {
    await this.identity.verifyEmail(req, query.token);
    return OK;
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Req() req: Request,
    @Body(new ZodValidationPipe(emailOnlyRequestSchema)) body: { email: string },
  ) {
    await this.identity.resendVerification(req, body.email);
    return ACCEPTED;
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  signIn(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(signInRequestSchema)) body: z.infer<typeof signInRequestSchema>,
  ): Promise<SignInResponse> {
    return this.identity.signIn(req, res, body);
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.identity.signOut(req, res);
    return OK;
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentIdentity() identity: Identity) {
    return this.identity.me(identity);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Req() req: Request,
    @Body(new ZodValidationPipe(emailOnlyRequestSchema)) body: { email: string },
  ) {
    await this.identity.forgotPassword(req, body.email);
    return ACCEPTED;
  }

  /** Checks a reset link without using it (the web page in 1.4 shows "expired" early). */
  @Get('password/reset')
  async checkResetToken(
    @Req() req: Request,
    @Query(new ZodValidationPipe(verifyEmailQuerySchema)) query: { token: string },
  ) {
    await this.identity.checkResetToken(req, query.token);
    return OK;
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Req() req: Request,
    @Body(new ZodValidationPipe(resetPasswordRequestSchema))
    body: z.infer<typeof resetPasswordRequestSchema>,
  ) {
    await this.identity.resetPassword(req, body);
    return OK;
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async changePassword(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(changePasswordRequestSchema))
    body: z.infer<typeof changePasswordRequestSchema>,
  ) {
    await this.identity.changePassword(req, res, identity, body);
    return OK;
  }
}
