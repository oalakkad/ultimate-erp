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
import { type Identity, IdentityService } from './identity.service.js';

type RequestWithIdentity = Request & { identity?: Identity };

/** Requires a valid session cookie; attaches the signed-in user to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly identityService: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithIdentity>();
    const identity = await this.identityService.resolveSession(req, http.getResponse<Response>());
    if (!identity) {
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, messageFor('UNAUTHENTICATED'));
    }
    req.identity = identity;
    return true;
  }
}

/** The signed-in identity, for routes protected by SessionGuard. */
export const CurrentIdentity = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const identity = ctx.switchToHttp().getRequest<RequestWithIdentity>().identity;
  if (!identity) throw new Error('CurrentIdentity used on a route without SessionGuard');
  return identity;
});
