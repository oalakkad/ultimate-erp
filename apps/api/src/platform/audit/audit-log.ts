import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { auditEvents, type TenantTransaction } from '@ultimate-erp/db';
import { type Request } from 'express';
import { clientIp } from '../request-context/client-ip.js';

export interface AuditEntry {
  tenantId: string;
  /** `module.resource.verb`, e.g. `access.member.roles_changed`. */
  action: string;
  actor?: { userId: string; membershipId?: string | undefined } | undefined;
  target?: { type: string; id: string } | undefined;
  /**
   * Facts needed to understand the change (IDs, role names, before/after of whitelisted
   * fields). Never passwords, tokens, codes or personal data beyond what identifies the target.
   */
  details?: Record<string, unknown>;
}

/**
 * Writes audit events inside the caller's tenant transaction, so an event exists if and only if
 * the change it describes committed (architecture.md §5 step 9). The table is append-only.
 */
@Injectable()
export class AuditLog {
  async record(tx: TenantTransaction, req: Request, entry: AuditEntry): Promise<void> {
    const ip = clientIp(req).replace(/^::ffff:/, '');
    await tx.insert(auditEvents).values({
      tenantId: entry.tenantId,
      action: entry.action,
      actorUserId: entry.actor?.userId ?? null,
      actorMembershipId: entry.actor?.membershipId ?? null,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      requestId: typeof req.id === 'string' ? req.id : null,
      ipAddress: isIP(ip) ? ip : null,
      details: entry.details ?? {},
    });
  }

  /** For changes made by a background job (no request, no person): records the job ID. */
  async recordSystem(tx: TenantTransaction, jobId: string, entry: AuditEntry): Promise<void> {
    await tx.insert(auditEvents).values({
      tenantId: entry.tenantId,
      action: entry.action,
      actorUserId: null,
      actorMembershipId: null,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      requestId: null,
      ipAddress: null,
      details: { ...entry.details, jobId },
    });
  }
}
