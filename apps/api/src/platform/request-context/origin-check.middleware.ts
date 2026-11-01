import { HttpStatus } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { isHeaderStateRequest } from './header-session.middleware.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * CSRF defence (security.md R7), on top of SameSite=Lax cookies: a browser always sends
 * `Origin` on cross-site state-changing requests, so any POST/PUT/PATCH/DELETE whose Origin is
 * neither the request's own host (same origin, e.g. a company address through the web app's
 * proxy) nor a configured public/web origin is refused. Requests without Origin (server
 * to server, mobile apps, curl) carry no ambient browser cookies from another site. The same
 * holds for requests that bring their auth state in a header (header-session.middleware.ts):
 * a browser never adds that header by itself, so no cross-site page can ride on it.
 */
export function originCheckMiddleware(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  return (req: Request, _res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (
      SAFE_METHODS.has(req.method) ||
      origin === undefined ||
      isHeaderStateRequest(req) ||
      allowed.has(origin) ||
      sameOrigin(origin, req.headers.host)
    ) {
      next();
      return;
    }
    next(new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, 'Cross-site request refused.'));
  };
}
