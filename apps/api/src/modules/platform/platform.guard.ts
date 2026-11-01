import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { IdentityService } from '../identity/identity.service.js';
import { PlatformService } from './platform.service.js';

/** The signed-in founder behind a platform route. */
export interface Operator {
  userId: string;
}

type RequestWithOperator = Request & { operator?: Operator };

/**
 * The gate in front of the platform console (docs/modules/platform.md §4): a valid session (401),
 * the main address only (company addresses answer 404 as if the routes did not exist), a row in
 * platform_operators (404 — nobody learns the console exists), and two-factor turned on (403
 * MFA_REQUIRED). Nothing here grants access to any company's data.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly platform: PlatformService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithOperator>();
    const identity = await this.identity.resolveSession(req, http.getResponse<Response>());
    if (!identity) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, messageFor('UNAUTHENTICATED'));
    }
    // Tenant resolution is skipped for /platform (main-address routes): check the host here.
    if (
      (await this.platform.isCompanyHost(req.hostname)) ||
      !(await this.platform.isOperator(identity.userId))
    ) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
    }
    const [user] = await this.identity.userSummaries([identity.userId]);
    if (!user?.twoFactorEnabled) {
      throw new AppError('MFA_REQUIRED', HttpStatus.FORBIDDEN, messageFor('MFA_REQUIRED'));
    }
    req.operator = { userId: identity.userId };
    return true;
  }
}

export const CurrentOperator = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const operator = ctx.switchToHttp().getRequest<RequestWithOperator>().operator;
  if (!operator) throw new Error('CurrentOperator used on a route without PlatformGuard');
  return operator;
});
