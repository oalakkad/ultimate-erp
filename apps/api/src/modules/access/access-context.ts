import {
  createParamDecorator,
  type ExecutionContext,
  applyDecorators,
  SetMetadata,
} from '@nestjs/common';
import {
  type EffectivePermissions,
  type Permission,
  type Scope,
  type Role,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';

/** Who is acting in which company, with what — attached to the request by AccessGuard. */
export interface AccessContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  roles: Role[];
  permissions: EffectivePermissions;
  twoFactorEnabled: boolean;
}

export type RequestWithAccess = Request & { access?: AccessContext };

export const REQUIRED_PERMISSION = 'access:required-permission';
export const ALLOW_WITHOUT_MFA = 'access:allow-without-mfa';

/** The route needs this permission (company scope unless the service checks a narrower one). */
export const REQUIRED_SCOPE = 'access:required-scope';

/**
 * The permission a route needs. `scope` is the least scope that may enter (default: company);
 * routes that accept project scope must then check the specific record in their service.
 */
export const RequirePermission = (permission: Permission, scope: Scope = 'company') =>
  applyDecorators(SetMetadata(REQUIRED_PERMISSION, permission), SetMetadata(REQUIRED_SCOPE, scope));

/** Reachable by a sensitive-role member who has not set up two-factor yet (e.g. "who am I"). */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);

export const CurrentAccess = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const access = ctx.switchToHttp().getRequest<RequestWithAccess>().access;
  if (!access) throw new Error('CurrentAccess used on a route without AccessGuard');
  return access;
});
