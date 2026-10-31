import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { from, type Observable, switchMap } from 'rxjs';
import { clientIp } from '../request-context/client-ip.js';
import { RateLimiter, type RateLimitRule } from './rate-limiter.js';

const ROUTE_LIMIT = 'rate-limit:route';

/**
 * Limits for heavy or bulk routes (docs/security.md R6, Phase 15b review). Counted per member
 * (company + person) so one busy colleague never blocks another; per IP when signed out.
 */
export const ROUTE_LIMITS = {
  /** CSV exports: whole lists leave the system (and are audited). */
  export: { name: 'export:member', limit: 30, windowSeconds: 60 * 60 },
  /** Uploads: storage and virus-scanning work. */
  upload: { name: 'upload:member', limit: 100, windowSeconds: 60 * 60 },
  /** Reports: queries over up to a year of company data. */
  report: { name: 'report:member', limit: 120, windowSeconds: 10 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Applies a route limit (checked after access control, before the handler runs). */
export const Limit = (rule: RateLimitRule) => SetMetadata(ROUTE_LIMIT, rule);

type RequestWithMember = Request & { access?: { tenantId: string; membershipId: string } };

/** Global interceptor enforcing `@Limit`; answers 429 with Retry-After when exceeded. */
@Injectable()
export class RouteLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(ROUTE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<RequestWithMember>();
    const subject = req.access
      ? `member:${req.access.tenantId}:${req.access.membershipId}`
      : `ip:${clientIp(req)}`;
    return from(this.limiter.consume(rule, subject)).pipe(switchMap(() => next.handle()));
  }
}
