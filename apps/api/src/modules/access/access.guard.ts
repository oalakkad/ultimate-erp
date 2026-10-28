import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  effectivePermissions,
  hasPermission,
  isSensitive,
  type Permission,
} from '@ultimate-erp/contracts';
import { type Response } from 'express';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { IdentityService } from '../identity/identity.service.js';
import { MissingTenantContextError, type RequestWithTenant } from '../tenancy/tenant-context.js';
import {
  ALLOW_WITHOUT_MFA,
  REQUIRED_PERMISSION,
  type RequestWithAccess,
} from './access-context.js';
import { AccessService } from './access.service.js';

const fail = (
  code: 'UNAUTHENTICATED' | 'NOT_FOUND' | 'MFA_REQUIRED' | 'FORBIDDEN',
  status: HttpStatus,
) => new AppError(code, status, messageFor(code));

/**
 * The gate in front of every company route, enforced on the server (brief §7, §14):
 * 1. a valid session (401), 2. an active membership in this company (404 — outsiders cannot
 * tell the company exists), 3. two-factor set up if any role is sensitive (403 MFA_REQUIRED),
 * 4. the route's permission (403 FORBIDDEN). Deny by default.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithTenant & RequestWithAccess>();
    if (!req.tenant) throw new MissingTenantContextError('AccessGuard needs a company route');

    const identity = await this.identity.resolveSession(req, http.getResponse<Response>());
    if (!identity) throw fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);

    const member = await this.access.activeMember(req.tenant.tenantId, identity.userId);
    if (!member) throw fail('NOT_FOUND', HttpStatus.NOT_FOUND);

    const [user] = await this.identity.userSummaries([identity.userId]);
    const twoFactorEnabled = user?.twoFactorEnabled ?? false;
    const targets = [context.getHandler(), context.getClass()];
    const allowWithoutMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets);
    if (isSensitive(member.roles) && !twoFactorEnabled && !allowWithoutMfa) {
      throw fail('MFA_REQUIRED', HttpStatus.FORBIDDEN);
    }

    const permissions = effectivePermissions(member.roles);
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (required && !hasPermission(permissions, required)) {
      throw fail('FORBIDDEN', HttpStatus.FORBIDDEN);
    }

    req.access = {
      tenantId: req.tenant.tenantId,
      userId: identity.userId,
      membershipId: member.membershipId,
      roles: member.roles,
      permissions,
      twoFactorEnabled,
    };
    return true;
  }
}
