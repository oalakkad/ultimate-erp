import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AccessMeResponse,
  canGrant,
  isRole,
  isSensitive,
  type Role,
  type Scope,
} from '@ultimate-erp/contracts';
import { membershipRoles, memberships, type TenantTransaction } from '@ultimate-erp/db';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { type Request } from 'express';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { IdentityService } from '../identity/identity.service.js';
import { type AccessContext } from './access-context.js';

const forbidden = (message: string) => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, message);
const notFound = () => new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));

/** Roles of one membership, read inside a tenant transaction. */
export async function rolesOf(tx: TenantTransaction, membershipId: string): Promise<Role[]> {
  const rows = await tx
    .select({ role: membershipRoles.role })
    .from(membershipRoles)
    .where(eq(membershipRoles.membershipId, membershipId));
  return rows.map((r) => r.role).filter(isRole);
}

/** Memberships, roles and the rules for changing them (docs/modules/access.md §2, §6.4). */
@Injectable()
export class AccessService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly identity: IdentityService,
    private readonly notifier: Notifier,
  ) {}

  /** The user's active membership in this tenant with its roles, or null. */
  async activeMember(
    tenantId: string,
    userId: string,
  ): Promise<{ membershipId: string; roles: Role[] } | null> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
      if (!member) return null;
      return { membershipId: member.id, roles: await rolesOf(tx, member.id) };
    });
  }

  me(access: AccessContext): AccessMeResponse {
    const permissions: Record<string, Scope[]> = {};
    for (const [permission, scopes] of access.permissions) permissions[permission] = [...scopes];
    return {
      tenantId: access.tenantId,
      membershipId: access.membershipId,
      roles: access.roles,
      permissions,
      twoFactorRequired: isSensitive(access.roles) && !access.twoFactorEnabled,
    };
  }

  async listMembers(access: AccessContext) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const members = await tx
        .select()
        .from(memberships)
        .where(ne(memberships.status, 'removed'))
        .orderBy(memberships.createdAt);
      const roles = members.length
        ? await tx
            .select()
            .from(membershipRoles)
            .where(
              inArray(
                membershipRoles.membershipId,
                members.map((m) => m.id),
              ),
            )
        : [];
      return members.map((m) => ({
        ...m,
        roles: roles
          .filter((r) => r.membershipId === m.id)
          .map((r) => r.role)
          .filter(isRole),
      }));
    });
    const people = new Map(
      (await this.identity.userSummaries(rows.map((r) => r.userId))).map((u) => [u.id, u]),
    );
    return rows.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: people.get(m.userId)?.name ?? '',
      email: people.get(m.userId)?.email ?? '',
      status: m.status,
      roles: m.roles,
      joinedAt: m.joinedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Replaces another member's roles. Refused for: yourself; a member whose current roles you
   * could not grant (e.g. a CEO editing an Owner); new roles you could not grant; removing the
   * last Owner.
   */
  async setRoles(req: Request, access: AccessContext, membershipId: string, roles: Role[]) {
    if (membershipId === access.membershipId) throw forbidden('You cannot change your own roles.');
    const next = [...new Set(roles)];
    const { userId, before } = await this.database.withTenant(access.tenantId, async (tx) => {
      const actorRoles = await this.beginRoleChange(tx, access);
      const target = await this.activeMemberById(tx, membershipId);
      const current = await rolesOf(tx, membershipId);
      if (!canGrant(actorRoles, current) || !canGrant(actorRoles, next)) {
        throw forbidden('You cannot grant or change roles beyond your own permissions.');
      }
      if (current.includes('owner') && !next.includes('owner')) {
        await this.assertAnotherOwner(tx, membershipId);
      }
      await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
      await tx
        .insert(membershipRoles)
        .values(next.map((role) => ({ tenantId: access.tenantId, membershipId, role })));
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'access.member.roles_changed',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'membership', id: membershipId },
        details: { before: current, after: next },
      });
      await this.notifier.notify(tx, req, {
        tenantId: access.tenantId,
        type: 'access.roles_changed',
        recipients: [target.userId],
        params: { roles: next.join(',') },
        link: '/',
        actor: { userId: access.userId, membershipId: access.membershipId },
      });
      return { userId: target.userId, before: current };
    });
    if (isSensitive(next) && !isSensitive(before)) await this.identity.revokeTrustedDevices(userId);
  }

  /** Marks another member removed (history kept). Same protections as setRoles. */
  async removeMember(req: Request, access: AccessContext, membershipId: string) {
    if (membershipId === access.membershipId) throw forbidden('You cannot remove yourself.');
    await this.database.withTenant(access.tenantId, async (tx) => {
      const actorRoles = await this.beginRoleChange(tx, access);
      await this.activeMemberById(tx, membershipId);
      const current = await rolesOf(tx, membershipId);
      if (!canGrant(actorRoles, current)) {
        throw forbidden('You cannot remove a member with more permissions than you.');
      }
      if (current.includes('owner')) await this.assertAnotherOwner(tx, membershipId);
      await tx
        .update(memberships)
        .set({ status: 'removed', version: sql`${memberships.version} + 1` })
        .where(eq(memberships.id, membershipId));
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'access.member.removed',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'membership', id: membershipId },
        details: { roles: current },
      });
    });
  }

  /**
   * Serializes membership/role changes within this company (a transaction-scoped advisory lock;
   * such changes are rare) so concurrent changes cannot interleave — e.g. two Owners demoting
   * each other at once — and cannot deadlock. Then re-reads the actor's own roles inside the
   * lock, so a member demoted a moment ago cannot act on stale permissions.
   */
  private async beginRoleChange(tx: TenantTransaction, access: AccessContext): Promise<Role[]> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`roles:${access.tenantId}`}, 0))`,
    );
    await this.activeMemberById(tx, access.membershipId);
    return rolesOf(tx, access.membershipId);
  }

  private async activeMemberById(tx: TenantTransaction, membershipId: string) {
    const [target] = await tx
      .select({ id: memberships.id, userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.status, 'active')));
    if (!target) throw notFound();
    return target;
  }

  /** Requires an active Owner other than `excluding` (called under beginRoleChange's lock). */
  private async assertAnotherOwner(tx: TenantTransaction, excluding: string): Promise<void> {
    const owners = await tx
      .select({ membershipId: membershipRoles.membershipId })
      .from(membershipRoles)
      .innerJoin(
        memberships,
        and(
          eq(memberships.tenantId, membershipRoles.tenantId),
          eq(memberships.id, membershipRoles.membershipId),
        ),
      )
      .where(and(eq(membershipRoles.role, 'owner'), eq(memberships.status, 'active')));
    if (!owners.some((o) => o.membershipId !== excluding)) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        'A company must keep at least one Owner.',
      );
    }
  }
}
