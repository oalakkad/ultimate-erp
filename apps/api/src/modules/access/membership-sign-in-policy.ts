import { Injectable } from '@nestjs/common';
import { invitations, memberships } from '@ultimate-erp/db';
import { and, eq, gt, sql } from 'drizzle-orm';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { type SignInPolicy } from '../identity/sign-in-policy.js';

/**
 * On a company's own address, only its active members — or people holding a pending
 * invitation there, who must sign in to accept it — may complete a sign-in. Other hosts
 * (the platform address) are unrestricted: company access is still checked on every request.
 */
@Injectable()
export class MembershipSignInPolicy implements SignInPolicy {
  constructor(private readonly database: TenantDatabase) {}

  async allows(hostname: string, user: { id: string; email: string }): Promise<boolean> {
    const tenantId = await this.database.resolveHost(hostname);
    if (!tenantId) return true;
    return this.database.withTenant(tenantId, async (tx) => {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active')));
      if (member) return true;
      const [invited] = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.email, sql`lower(${user.email})`),
            eq(invitations.status, 'pending'),
            gt(invitations.expiresAt, new Date()),
          ),
        );
      return invited !== undefined;
    });
  }
}
