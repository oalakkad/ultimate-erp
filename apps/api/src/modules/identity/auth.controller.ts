import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  acceptedResponseSchema,
  changePasswordRequestSchema,
  emailOnlyRequestSchema,
  handoffRequestSchema,
  handoffResponseSchema,
  meResponseSchema,
  myCompaniesResponseSchema,
  okResponseSchema,
  redeemHandoffRequestSchema,
  resetPasswordRequestSchema,
  signInRequestSchema,
  type SignInResponse,
  signInResponseSchema,
  signUpRequestSchema,
  updateMeRequestSchema,
  userSchema,
  verifyEmailQuerySchema,
} from '@ultimate-erp/contracts';
import { type Request, type Response } from 'express';
import { type z } from 'zod';
import { ApiContract } from '../../platform/openapi/api-contract.js';
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
  @ApiContract({
    summary: 'Create an account; sends a verification email',
    auth: 'public',
    body: signUpRequestSchema,
    response: acceptedResponseSchema,
    status: 202,
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async signUp(
    @Req() req: Request,
    @Body(new ZodValidationPipe(signUpRequestSchema)) body: z.infer<typeof signUpRequestSchema>,
  ) {
    await this.identity.signUp(req, body);
    return ACCEPTED;
  }

  @Get('verify-email')
  @ApiContract({
    summary: 'Confirm an email address from the emailed link',
    auth: 'public',
    query: verifyEmailQuerySchema,
    response: okResponseSchema,
  })
  async verifyEmail(
    @Req() req: Request,
    @Query(new ZodValidationPipe(verifyEmailQuerySchema)) query: { token: string },
  ) {
    await this.identity.verifyEmail(req, query.token);
    return OK;
  }

  @Post('verify-email/resend')
  @ApiContract({
    summary: 'Send the verification email again',
    auth: 'public',
    body: emailOnlyRequestSchema,
    response: acceptedResponseSchema,
    status: 202,
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Req() req: Request,
    @Body(new ZodValidationPipe(emailOnlyRequestSchema)) body: { email: string },
  ) {
    await this.identity.resendVerification(req, body.email);
    return ACCEPTED;
  }

  @Post('sign-in')
  @ApiContract({
    summary: 'Sign in with email and password',
    auth: 'public',
    body: signInRequestSchema,
    response: signInResponseSchema,
  })
  @HttpCode(HttpStatus.OK)
  signIn(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(signInRequestSchema)) body: z.infer<typeof signInRequestSchema>,
  ): Promise<SignInResponse> {
    return this.identity.signIn(req, res, body);
  }

  @Post('sign-out')
  @ApiContract({ summary: 'End this session', auth: 'session', response: okResponseSchema })
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.identity.signOut(req, res);
    return OK;
  }

  @Get('me')
  @ApiContract({
    summary: 'The signed-in user and session',
    auth: 'session',
    response: meResponseSchema,
  })
  @UseGuards(SessionGuard)
  me(@CurrentIdentity() identity: Identity) {
    return this.identity.me(identity);
  }

  /** Name and preferred language (the saved language wins over browser/company defaults). */
  @Patch('me')
  @ApiContract({
    summary: 'Update my name or language',
    auth: 'session',
    body: updateMeRequestSchema,
    response: userSchema,
  })
  @UseGuards(SessionGuard)
  updateMe(
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(updateMeRequestSchema)) body: z.infer<typeof updateMeRequestSchema>,
  ) {
    return this.identity.updateMe(identity, body);
  }

  @Get('companies')
  @ApiContract({
    summary: 'The companies I belong to',
    auth: 'session',
    response: myCompaniesResponseSchema,
  })
  @UseGuards(SessionGuard)
  async companies(@CurrentIdentity() identity: Identity) {
    return { companies: await this.identity.myCompanies(identity) };
  }

  /** Main address → company address: returns the company URL with a one-time ticket. */
  @Post('handoff')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Get a one-time ticket to open one of my companies',
    auth: 'session',
    body: handoffRequestSchema,
    response: handoffResponseSchema,
  })
  @UseGuards(SessionGuard)
  handoff(
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(handoffRequestSchema)) body: { tenantId: string },
  ) {
    return this.identity.createHandoff(identity, body.tenantId);
  }

  /** On the company address: exchange the ticket for a session here. */
  @Post('handoff/redeem')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Exchange a hand-off ticket for a session on this company address',
    auth: 'public',
    companyHost: true,
    body: redeemHandoffRequestSchema,
    response: signInResponseSchema,
  })
  redeemHandoff(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(redeemHandoffRequestSchema)) body: { ticket: string },
  ): Promise<SignInResponse> {
    return this.identity.redeemHandoff(req, res, body.ticket);
  }

  @Post('password/forgot')
  @ApiContract({
    summary: 'Email a password-reset link',
    auth: 'public',
    body: emailOnlyRequestSchema,
    response: acceptedResponseSchema,
    status: 202,
  })
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
  @ApiContract({
    summary: 'Check whether a reset link is still valid (does not use it)',
    auth: 'public',
    query: verifyEmailQuerySchema,
    response: okResponseSchema,
  })
  async checkResetToken(
    @Req() req: Request,
    @Query(new ZodValidationPipe(verifyEmailQuerySchema)) query: { token: string },
  ) {
    await this.identity.checkResetToken(req, query.token);
    return OK;
  }

  @Post('password/reset')
  @ApiContract({
    summary: 'Set a new password from a reset link; signs out everywhere',
    auth: 'public',
    body: resetPasswordRequestSchema,
    response: okResponseSchema,
  })
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
  @ApiContract({
    summary: 'Change password (current password required)',
    auth: 'session',
    body: changePasswordRequestSchema,
    response: okResponseSchema,
  })
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
