import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';

/** The tenant a request belongs to, resolved server-side from the request host. */
export interface TenantContext {
  tenantId: string;
}

/** An Express request after TenantResolutionMiddleware has run. */
export type RequestWithTenant = Request & { tenant?: TenantContext };

/** Thrown when a handler needs a tenant but the request has none: a wiring bug, never data. */
export class MissingTenantContextError extends Error {
  override readonly name = 'MissingTenantContextError';
}

/**
 * Injects the resolved tenant into a controller method: `@CurrentTenant() tenant: TenantContext`.
 * Fails closed (500) if TenantResolutionMiddleware did not run for this route.
 */
export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const tenant = ctx.switchToHttp().getRequest<RequestWithTenant>().tenant;
  if (!tenant) {
    throw new MissingTenantContextError('No tenant context on this request');
  }
  return tenant;
});
