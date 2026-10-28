import { Global, Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { SIGN_IN_POLICY } from '../identity/sign-in-policy.js';
import { AccessController } from './access.controller.js';
import { AccessGuard } from './access.guard.js';
import { AccessService } from './access.service.js';
import { AuditEventsService } from './audit-events.service.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembershipSignInPolicy } from './membership-sign-in-policy.js';

/**
 * Provides the company sign-in rule to the identity module without identity importing access
 * (identity only declares the SIGN_IN_POLICY hook).
 */
@Global()
@Module({
  providers: [{ provide: SIGN_IN_POLICY, useClass: MembershipSignInPolicy }],
  exports: [SIGN_IN_POLICY],
})
export class SignInPolicyModule {}

@Module({
  imports: [IdentityModule],
  controllers: [CompaniesController, AccessController, InvitationsController],
  providers: [AccessService, AccessGuard, CompaniesService, InvitationsService, AuditEventsService],
  exports: [AccessGuard, AccessService],
})
export class AccessModule {}
