import { HttpStatus, Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Response } from 'express';
import { AppError } from '../../platform/errors/app-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { type RequestWithTenant } from './tenant-context.js';

/**
 * Resolves the tenant from the request's Host header (e.g. `acme.localhost`) and attaches it
 * to the request. The client never chooses the tenant by sending an ID (ADR-0003).
 *
 * X-Forwarded-Host is ignored because Express "trust proxy" is off; it will only be honoured
 * behind our own reverse proxy once deployment configures that explicitly.
 * An unknown, unverified or suspended host gets 404 — it does not confirm a company exists.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(private readonly database: TenantDatabase) {}

  async use(req: RequestWithTenant, _res: Response, next: NextFunction): Promise<void> {
    // req.hostname is the Host header without the port, as sent by the client.
    const tenantId = await this.database.resolveHost(req.hostname);
    if (!tenantId) {
      throw new AppError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'The requested resource was not found.',
      );
    }
    req.tenant = { tenantId };
    next();
  }
}
