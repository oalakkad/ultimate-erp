import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type createEmployeeRequestSchema,
  type Employee,
  EMPLOYEE_TRANSITIONS,
  type EmployeeStatus,
  type EmployeeSummary,
  hasPermission,
  OFFBOARDING_ITEMS,
  ONBOARDING_ITEMS,
  type PrivateDetails,
  privateDetailsSchema,
  type updateEmployeeRequestSchema,
} from '@ultimate-erp/contracts';
import {
  departments,
  employeeChecklistItems,
  employeeDocuments,
  employeeEmergencyContacts,
  employeeHistory,
  employeePrivate,
  employees,
  files,
  membershipRoles,
  memberships,
  teamMembers,
  teams,
  type TenantTransaction,
} from '@ultimate-erp/db';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { type Request } from 'express';
import { z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { FieldCipher } from '../../platform/crypto/field-cipher.js';
import { nextDocumentNumber } from '../../platform/database/numbering.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { DOWNLOAD_URL_SECONDS, ObjectStorage } from '../../platform/files/object-storage.js';
import { type AccessContext } from '../access/access-context.js';
import { IdentityService } from '../identity/identity.service.js';

type EmployeeRow = typeof employees.$inferSelect;

const notFound = () => new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
const forbidden = () => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, messageFor('FORBIDDEN'));
const invalid = (path: string, code: string) =>
  new AppError(
    'VALIDATION_FAILED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    messageFor('VALIDATION_FAILED'),
    [{ path, code }],
  );
const conflict = (path: string, code: string, message: string) =>
  new AppError('CONFLICT', HttpStatus.CONFLICT, message, [{ path, code }]);
const contactSchema = z.object({ name: z.string(), relationship: z.string(), phone: z.string() });

/** Fields whose changes go into the employment history (never private details). */
const HISTORY_FIELDS = [
  'jobTitleEn',
  'jobTitleAr',
  'departmentId',
  'managerMembershipId',
  'employmentType',
  'joinDate',
  'weeklyHours',
  'workDays',
] as const;

/**
 * People in my "team" scope: members of teams I lead and my direct reports
 * (docs/modules/people.md §5). Used by later modules (leave approvals).
 */
export async function teamScopeOf(
  tx: TenantTransaction,
  membershipId: string,
): Promise<Set<string>> {
  const led = await tx
    .select({ id: teamMembers.membershipId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teams.leadMembershipId, membershipId), isNull(teams.archivedAt)));
  const reports = await tx
    .select({ id: employees.membershipId })
    .from(employees)
    .where(eq(employees.managerMembershipId, membershipId));
  return new Set([...led, ...reports].map((r) => r.id).filter((id) => id !== membershipId));
}

/** Employees & teams (docs/modules/people.md). */
@Injectable()
export class PeopleService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly identity: IdentityService,
    private readonly cipher: FieldCipher,
    private readonly storage: ObjectStorage,
  ) {}

  // --- access levels (§4) --------------------------------------------------------------------

  private async canSeeDirectory(
    tx: TenantTransaction,
    access: AccessContext,
    membershipId: string,
  ) {
    const has = (s: 'company' | 'team' | 'own') =>
      hasPermission(access.permissions, 'people.employee.read', s);
    if (has('company')) return true;
    if (membershipId === access.membershipId) return has('own');
    return has('team') && (await teamScopeOf(tx, access.membershipId)).has(membershipId);
  }

  private canSeeDetails(access: AccessContext, row: EmployeeRow) {
    return (
      hasPermission(access.permissions, 'people.employee.read', 'company') ||
      hasPermission(access.permissions, 'people.employee.manage', 'company') ||
      row.membershipId === access.membershipId ||
      row.managerMembershipId === access.membershipId
    );
  }

  private canSeeRestricted(access: AccessContext, membershipId: string) {
    if (hasPermission(access.permissions, 'people.employee.read_restricted', 'company'))
      return true;
    return (
      membershipId === access.membershipId &&
      hasPermission(access.permissions, 'people.employee.read_restricted', 'own')
    );
  }

  private canManage(access: AccessContext) {
    return hasPermission(access.permissions, 'people.employee.manage', 'company');
  }

  private async load(
    tx: TenantTransaction,
    access: AccessContext,
    membershipId: string,
    lock = false,
  ) {
    const query = tx.select().from(employees).where(eq(employees.membershipId, membershipId));
    const [row] = lock ? await query.for('update') : await query;
    if (!row || !(await this.canSeeDirectory(tx, access, membershipId))) throw notFound();
    return row;
  }

  // --- directory -----------------------------------------------------------------------------

  async list(
    access: AccessContext,
    query: {
      search?: string | undefined;
      departmentId?: string | undefined;
      teamId?: string | undefined;
      status?: EmployeeStatus | undefined;
    },
  ) {
    const { rows, refs } = await this.database.withTenant(access.tenantId, async (tx) => {
      let visible: Set<string> | null = null;
      if (!hasPermission(access.permissions, 'people.employee.read', 'company')) {
        visible = hasPermission(access.permissions, 'people.employee.read', 'team')
          ? await teamScopeOf(tx, access.membershipId)
          : new Set();
        visible.add(access.membershipId);
      }
      const found = await tx
        .select()
        .from(employees)
        .where(
          and(
            query.departmentId ? eq(employees.departmentId, query.departmentId) : undefined,
            query.status ? eq(employees.status, query.status) : undefined,
            query.teamId
              ? sql`exists (select 1 from team_members tm where tm.tenant_id = ${employees.tenantId} and tm.team_id = ${query.teamId} and tm.membership_id = ${employees.membershipId})`
              : undefined,
          ),
        )
        .orderBy(asc(employees.number))
        .limit(1000);
      const scoped = visible ? found.filter((r) => visible.has(r.membershipId)) : found;
      return { rows: scoped, refs: await this.refsFor(tx, scoped) };
    });
    const names = await this.namesOf(
      access,
      rows.flatMap((r) => [
        r.membershipId,
        ...(r.managerMembershipId ? [r.managerMembershipId] : []),
      ]),
    );
    let items = rows.map((r) => this.toSummary(r, names, refs));
    if (query.search) {
      const term = query.search.toLowerCase();
      items = items.filter((i) =>
        [
          i.name,
          i.number,
          i.jobTitle.en,
          i.jobTitle.ar,
          i.department?.name.en ?? '',
          i.department?.name.ar ?? '',
        ].some((v) => v.toLowerCase().includes(term)),
      );
    }
    return { items };
  }

  /** Active members who have no employee record yet (for "New employee"). */
  async candidates(access: AccessContext) {
    if (!this.canManage(access)) throw forbidden();
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select({ id: memberships.id, userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.status, 'active'),
            sql`not exists (select 1 from employees e where e.tenant_id = ${memberships.tenantId} and e.membership_id = ${memberships.id})`,
          ),
        ),
    );
    const users = new Map(
      (await this.identity.userSummaries(rows.map((r) => r.userId))).map((u) => [u.id, u]),
    );
    return {
      items: rows
        .flatMap((r) => {
          const u = users.get(r.userId);
          return u ? [{ membershipId: r.id, name: u.name, email: u.email }] : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async get(access: AccessContext, membershipId: string): Promise<Employee> {
    return this.database.withTenant(access.tenantId, async (tx) =>
      this.toEmployee(tx, access, await this.load(tx, access, membershipId)),
    );
  }

  // --- create / update / status --------------------------------------------------------------

  async create(
    req: Request,
    access: AccessContext,
    input: z.output<typeof createEmployeeRequestSchema>,
  ) {
    if (!this.canManage(access)) throw forbidden();
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const [member] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.status, 'active')));
        if (!member) throw invalid('membershipId', 'not_found');
        await this.assertRefs(tx, input);
        const number = await nextDocumentNumber(tx, access.tenantId, 'employee', 'E');
        const [row] = await tx
          .insert(employees)
          .values({
            tenantId: access.tenantId,
            membershipId: input.membershipId,
            number,
            jobTitleEn: input.jobTitleEn ?? '',
            jobTitleAr: input.jobTitleAr ?? '',
            departmentId: input.departmentId ?? null,
            managerMembershipId: input.managerMembershipId ?? null,
            employmentType: input.employmentType ?? 'full_time',
            joinDate: input.joinDate ?? null,
            ...(input.weeklyHours ? { weeklyHours: input.weeklyHours } : {}),
            ...(input.workDays ? { workDays: input.workDays } : {}),
          })
          .returning();
        if (!row) throw new Error('employee insert returned nothing');
        await this.history(tx, access, row.membershipId, 'joined', {});
        await this.startChecklist(tx, access, row.membershipId, 'onboarding');
        await this.record(tx, req, access, row.membershipId, 'people.employee.created', { number });
        return this.toEmployee(tx, access, row);
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('membershipId', 'exists', 'This member already has an employee record.');
      throw err;
    }
  }

  async update(
    req: Request,
    access: AccessContext,
    membershipId: string,
    input: z.output<typeof updateEmployeeRequestSchema>,
  ) {
    if (!this.canManage(access)) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, membershipId, true);
      if (current.status === 'left')
        throw conflict('status', 'left', 'The record of someone who left cannot change.');
      if (current.version !== input.version)
        throw conflict('version', 'stale', 'The record was changed by someone else.');
      await this.assertRefs(tx, input, membershipId);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of HISTORY_FIELDS) {
        const next = input[field];
        if (next !== undefined && JSON.stringify(next) !== JSON.stringify(current[field]))
          changes[field] = { from: current[field], to: next };
      }
      if (Object.keys(changes).length === 0) return this.toEmployee(tx, access, current);
      const set = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to]));
      const [row] = await tx
        .update(employees)
        .set({ ...set, version: current.version + 1 })
        .where(eq(employees.membershipId, membershipId))
        .returning();
      if (!row) throw notFound();
      await this.history(tx, access, membershipId, 'changed', changes);
      await this.record(tx, req, access, membershipId, 'people.employee.updated', {
        fields: Object.keys(changes),
      });
      return this.toEmployee(tx, access, row);
    });
  }

  async setStatus(
    req: Request,
    access: AccessContext,
    membershipId: string,
    status: EmployeeStatus,
    leaveDate?: string,
  ) {
    if (!this.canManage(access)) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, membershipId, true);
      if (!EMPLOYEE_TRANSITIONS[current.status].includes(status)) {
        throw conflict(
          'status',
          'invalid_transition',
          `${current.status} cannot become ${status}.`,
        );
      }
      const date = leaveDate ?? current.leaveDate;
      if (status === 'left' && !date) throw invalid('leaveDate', 'required');
      if (status === 'left') await this.assertMayEnd(tx, access, membershipId);
      const [row] = await tx
        .update(employees)
        .set({
          status,
          ...(status === 'left' || status === 'offboarding' ? { leaveDate: date ?? null } : {}),
          ...(status === 'active' && current.status === 'offboarding' ? { leaveDate: null } : {}),
          version: current.version + 1,
        })
        .where(eq(employees.membershipId, membershipId))
        .returning();
      if (!row) throw notFound();
      await this.history(tx, access, membershipId, 'status', {
        status: { from: current.status, to: status },
      });
      if (status === 'offboarding')
        await this.startChecklist(tx, access, membershipId, 'offboarding');
      if (status === 'left') {
        // Leaving ends access to this company and team memberships; the record stays.
        await tx
          .update(memberships)
          .set({ status: 'suspended', version: sql`${memberships.version} + 1` })
          .where(eq(memberships.id, membershipId));
        await tx.delete(teamMembers).where(eq(teamMembers.membershipId, membershipId));
        await tx
          .update(teams)
          .set({ leadMembershipId: null })
          .where(eq(teams.leadMembershipId, membershipId));
      }
      await this.record(tx, req, access, membershipId, 'people.employee.status_changed', {
        from: current.status,
        to: status,
      });
      return this.toEmployee(tx, access, row);
    });
  }

  /** Only an Owner ends an Owner's or CEO's employment, and never the last Owner. */
  private async assertMayEnd(tx: TenantTransaction, access: AccessContext, membershipId: string) {
    if (membershipId === access.membershipId) throw forbidden();
    const roles = (
      await tx
        .select({ role: membershipRoles.role })
        .from(membershipRoles)
        .where(eq(membershipRoles.membershipId, membershipId))
    ).map((r) => r.role);
    if (roles.includes('owner') || roles.includes('ceo')) {
      const mine = await tx
        .select({ role: membershipRoles.role })
        .from(membershipRoles)
        .where(eq(membershipRoles.membershipId, access.membershipId));
      if (!mine.some((r) => r.role === 'owner')) throw forbidden();
    }
    if (roles.includes('owner')) {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(membershipRoles)
        .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
        .where(
          and(
            eq(membershipRoles.role, 'owner'),
            eq(memberships.status, 'active'),
            ne(memberships.id, membershipId),
          ),
        );
      if ((others?.n ?? 0) === 0)
        throw conflict('status', 'last_owner', 'The last Owner cannot leave.');
    }
  }

  /** Department and manager must exist in this company; the reporting line cannot loop. */
  private async assertRefs(
    tx: TenantTransaction,
    input: {
      departmentId?: string | null | undefined;
      managerMembershipId?: string | null | undefined;
    },
    self?: string,
  ) {
    if (input.departmentId) {
      const [d] = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.id, input.departmentId), isNull(departments.archivedAt)));
      if (!d) throw invalid('departmentId', 'not_found');
    }
    if (input.managerMembershipId) {
      const [m] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.id, input.managerMembershipId), eq(memberships.status, 'active')),
        );
      if (!m) throw invalid('managerMembershipId', 'not_found');
      if (self) {
        let cursor: string | null = input.managerMembershipId;
        const seen = new Set<string>();
        while (cursor && !seen.has(cursor)) {
          if (cursor === self)
            throw conflict(
              'managerMembershipId',
              'cycle',
              'This would make the reporting line loop.',
            );
          seen.add(cursor);
          const [up] = await tx
            .select({ manager: employees.managerMembershipId })
            .from(employees)
            .where(eq(employees.membershipId, cursor));
          cursor = up?.manager ?? null;
        }
      }
    }
  }

  // --- restricted ----------------------------------------------------------------------------

  async privateDetails(req: Request, access: AccessContext, membershipId: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, membershipId);
      if (!this.canSeeRestricted(access, membershipId)) throw forbidden();
      const [row] = await tx
        .select()
        .from(employeePrivate)
        .where(eq(employeePrivate.membershipId, membershipId));
      await this.record(tx, req, access, membershipId, 'people.private.read');
      return {
        details: row
          ? privateDetailsSchema.parse(this.cipher.open(access.tenantId, row.sealed))
          : {},
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async setPrivateDetails(
    req: Request,
    access: AccessContext,
    membershipId: string,
    details: PrivateDetails,
  ) {
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const row = await this.load(tx, access, membershipId);
        if (row.status === 'left') {
          throw conflict('status', 'left', 'The record of someone who left cannot change.');
        }
        // HR maintains these; people may update their own.
        const mayWrite =
          (this.canManage(access) && this.canSeeRestricted(access, membershipId)) ||
          (membershipId === access.membershipId && this.canSeeRestricted(access, membershipId));
        if (!mayWrite) throw forbidden();
        const sealed = this.cipher.seal(access.tenantId, details);
        const civilIdHash = details.civilId
          ? this.cipher.lookupHash(access.tenantId, details.civilId)
          : null;
        await tx
          .insert(employeePrivate)
          .values({
            tenantId: access.tenantId,
            membershipId,
            sealed,
            civilIdHash,
            updatedByUserId: access.userId,
          })
          .onConflictDoUpdate({
            target: [employeePrivate.tenantId, employeePrivate.membershipId],
            set: { sealed, civilIdHash, updatedByUserId: access.userId },
          });
        // Field names only — never values.
        await this.record(tx, req, access, membershipId, 'people.private.updated', {
          fields: Object.keys(details),
        });
        return { details, updatedAt: new Date().toISOString() };
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('civilId', 'duplicate', 'Another employee has this civil ID.');
      throw err;
    }
  }

  async contacts(req: Request, access: AccessContext, membershipId: string) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, membershipId);
      if (!this.canSeeRestricted(access, membershipId)) throw forbidden();
      const rows = await tx
        .select()
        .from(employeeEmergencyContacts)
        .where(eq(employeeEmergencyContacts.membershipId, membershipId))
        .orderBy(asc(employeeEmergencyContacts.createdAt));
      await this.record(tx, req, access, membershipId, 'people.contacts.read');
      return {
        items: rows.map((r) => ({
          id: r.id,
          ...contactSchema.parse(this.cipher.open(access.tenantId, r.sealed)),
        })),
      };
    });
  }

  async addContact(
    req: Request,
    access: AccessContext,
    membershipId: string,
    contact: z.infer<typeof contactSchema>,
  ) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, membershipId);
      const mayWrite =
        this.canSeeRestricted(access, membershipId) &&
        (this.canManage(access) || membershipId === access.membershipId);
      if (!mayWrite) throw forbidden();
      await tx.insert(employeeEmergencyContacts).values({
        tenantId: access.tenantId,
        membershipId,
        sealed: this.cipher.seal(access.tenantId, contact),
      });
      await this.record(tx, req, access, membershipId, 'people.contacts.updated');
    });
    return this.contacts(req, access, membershipId);
  }

  async removeContact(
    req: Request,
    access: AccessContext,
    membershipId: string,
    contactId: string,
  ) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, membershipId);
      const mayWrite =
        this.canSeeRestricted(access, membershipId) &&
        (this.canManage(access) || membershipId === access.membershipId);
      if (!mayWrite) throw forbidden();
      const removed = await tx
        .delete(employeeEmergencyContacts)
        .where(
          and(
            eq(employeeEmergencyContacts.id, contactId),
            eq(employeeEmergencyContacts.membershipId, membershipId),
          ),
        )
        .returning();
      if (removed.length === 0) throw notFound();
      await this.record(tx, req, access, membershipId, 'people.contacts.updated');
    });
  }

  // --- history, checklist, documents ---------------------------------------------------------

  async historyOf(access: AccessContext, membershipId: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const row = await this.load(tx, access, membershipId);
      if (!this.canSeeDetails(access, row)) throw forbidden();
      return tx
        .select()
        .from(employeeHistory)
        .where(eq(employeeHistory.membershipId, membershipId))
        .orderBy(desc(employeeHistory.id));
    });
    const names = await this.userNames(rows.map((r) => r.changedByUserId));
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        changes: r.changes,
        changedByName: names.get(r.changedByUserId) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async checklist(access: AccessContext, membershipId: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const row = await this.load(tx, access, membershipId);
      if (!this.canSeeDetails(access, row)) throw forbidden();
      return tx
        .select()
        .from(employeeChecklistItems)
        .where(eq(employeeChecklistItems.membershipId, membershipId))
        .orderBy(asc(employeeChecklistItems.kind), asc(employeeChecklistItems.position));
    });
    const names = await this.userNames(
      rows.flatMap((r) => (r.doneByUserId ? [r.doneByUserId] : [])),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        done: r.doneAt !== null,
        doneAt: r.doneAt?.toISOString() ?? null,
        doneByName: r.doneByUserId ? (names.get(r.doneByUserId) ?? null) : null,
      })),
    };
  }

  async addChecklistItem(
    req: Request,
    access: AccessContext,
    membershipId: string,
    kind: 'onboarding' | 'offboarding',
    title: string,
  ) {
    if (!this.canManage(access)) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, membershipId);
      const [last] = await tx
        .select({ n: sql<number>`coalesce(max(${employeeChecklistItems.position}), 0)::int` })
        .from(employeeChecklistItems)
        .where(eq(employeeChecklistItems.membershipId, membershipId));
      await tx.insert(employeeChecklistItems).values({
        tenantId: access.tenantId,
        membershipId,
        kind,
        title,
        position: (last?.n ?? 0) + 1,
      });
      await this.record(tx, req, access, membershipId, 'people.checklist.changed');
    });
    return this.checklist(access, membershipId);
  }

  async tickChecklist(
    req: Request,
    access: AccessContext,
    membershipId: string,
    itemId: string,
    done: boolean,
  ) {
    if (!this.canManage(access)) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, membershipId);
      const updated = await tx
        .update(employeeChecklistItems)
        .set(
          done
            ? { doneAt: new Date(), doneByUserId: access.userId }
            : { doneAt: null, doneByUserId: null },
        )
        .where(
          and(
            eq(employeeChecklistItems.id, itemId),
            eq(employeeChecklistItems.membershipId, membershipId),
          ),
        )
        .returning();
      if (updated.length === 0) throw notFound();
      await this.record(tx, req, access, membershipId, 'people.checklist.changed');
    });
    return this.checklist(access, membershipId);
  }

  private async startChecklist(
    tx: TenantTransaction,
    access: AccessContext,
    membershipId: string,
    kind: 'onboarding' | 'offboarding',
  ) {
    const [existing] = await tx
      .select({ id: employeeChecklistItems.id })
      .from(employeeChecklistItems)
      .where(
        and(
          eq(employeeChecklistItems.membershipId, membershipId),
          eq(employeeChecklistItems.kind, kind),
        ),
      )
      .limit(1);
    if (existing) return;
    const items = kind === 'onboarding' ? ONBOARDING_ITEMS : OFFBOARDING_ITEMS;
    await tx.insert(employeeChecklistItems).values(
      items.map((key, i) => ({
        tenantId: access.tenantId,
        membershipId,
        kind,
        title: `builtin:${key}`,
        position: i + 1,
      })),
    );
  }

  async documents(access: AccessContext, membershipId: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const row = await this.load(tx, access, membershipId);
      if (!this.canSeeDetails(access, row)) throw forbidden();
      const restricted = this.canSeeRestricted(access, membershipId);
      return tx
        .select({ link: employeeDocuments, file: files })
        .from(employeeDocuments)
        .innerJoin(files, eq(files.id, employeeDocuments.fileId))
        .where(
          and(
            eq(employeeDocuments.membershipId, membershipId),
            restricted ? undefined : eq(employeeDocuments.confidential, false),
          ),
        )
        .orderBy(desc(employeeDocuments.createdAt));
    });
    const names = await this.userNames(rows.map((r) => r.link.addedByUserId));
    return rows.map(({ link, file }) => ({
      file: {
        id: file.id,
        name: file.displayName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        status: file.status,
        createdAt: file.createdAt.toISOString(),
      },
      category: link.category,
      confidential: link.confidential,
      addedAt: link.createdAt.toISOString(),
      addedByName: names.get(link.addedByUserId) ?? null,
    }));
  }

  async attachDocument(
    req: Request,
    access: AccessContext,
    membershipId: string,
    input: {
      fileId: string;
      category?: 'contract' | 'identity' | 'certificate' | 'other' | undefined;
      confidential?: boolean | undefined;
    },
  ) {
    if (!this.canManage(access)) throw forbidden();
    try {
      await this.database.withTenant(access.tenantId, async (tx) => {
        await this.load(tx, access, membershipId);
        const [file] = await tx
          .select({ status: files.status })
          .from(files)
          .where(and(eq(files.id, input.fileId), eq(files.uploadedByUserId, access.userId)));
        if (!file) throw invalid('fileId', 'not_found');
        if (file.status === 'infected') throw invalid('fileId', 'infected');
        await tx.insert(employeeDocuments).values({
          tenantId: access.tenantId,
          membershipId,
          fileId: input.fileId,
          category: input.category ?? 'other',
          confidential: input.confidential ?? true,
          addedByUserId: access.userId,
        });
        await this.record(tx, req, access, membershipId, 'people.document.attached', {
          fileId: input.fileId,
        });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('fileId', 'already_attached', 'This file is already attached.');
      throw err;
    }
    return this.documents(access, membershipId);
  }

  async detachDocument(req: Request, access: AccessContext, membershipId: string, fileId: string) {
    if (!this.canManage(access)) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.load(tx, access, membershipId);
      const removed = await tx
        .delete(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.membershipId, membershipId),
            eq(employeeDocuments.fileId, fileId),
          ),
        )
        .returning();
      if (removed.length === 0) throw notFound();
      await this.record(tx, req, access, membershipId, 'people.document.detached', { fileId });
    });
  }

  async documentDownload(
    req: Request,
    access: AccessContext,
    membershipId: string,
    fileId: string,
  ) {
    const file = await this.database.withTenant(access.tenantId, async (tx) => {
      const row = await this.load(tx, access, membershipId);
      if (!this.canSeeDetails(access, row)) throw forbidden();
      const [link] = await tx
        .select({ link: employeeDocuments, file: files })
        .from(employeeDocuments)
        .innerJoin(files, eq(files.id, employeeDocuments.fileId))
        .where(
          and(
            eq(employeeDocuments.membershipId, membershipId),
            eq(employeeDocuments.fileId, fileId),
          ),
        );
      if (!link || (link.link.confidential && !this.canSeeRestricted(access, membershipId)))
        throw notFound();
      if (link.file.status !== 'clean')
        throw new AppError('FILE_NOT_READY', HttpStatus.CONFLICT, messageFor('FILE_NOT_READY'));
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'files.file.downloaded',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'file', id: fileId },
        details: { employee: membershipId },
      });
      return link.file;
    });
    const url = await this.storage.downloadUrl(file.storageKey, file.displayName, file.contentType);
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  // --- organisation --------------------------------------------------------------------------

  async departments(access: AccessContext) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const rows = await tx.select().from(departments).orderBy(asc(departments.nameEn));
      const counts = await tx
        .select({ id: employees.departmentId, n: sql<number>`count(*)::int` })
        .from(employees)
        .where(ne(employees.status, 'left'))
        .groupBy(employees.departmentId);
      return {
        items: rows.map((d) => ({
          id: d.id,
          name: { en: d.nameEn, ar: d.nameAr },
          archived: d.archivedAt !== null,
          people: counts.find((c) => c.id === d.id)?.n ?? 0,
        })),
      };
    });
  }

  async saveDepartment(
    req: Request,
    access: AccessContext,
    id: string | null,
    input: {
      nameEn?: string | undefined;
      nameAr?: string | undefined;
      archived?: boolean | undefined;
    },
  ) {
    if (!hasPermission(access.permissions, 'people.org.manage', 'company')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      if (id === null) {
        await tx.insert(departments).values({
          tenantId: access.tenantId,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
        });
      } else {
        const updated = await tx
          .update(departments)
          .set({
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
            ...(input.archived !== undefined
              ? { archivedAt: input.archived ? new Date() : null }
              : {}),
          })
          .where(eq(departments.id, id))
          .returning();
        if (updated.length === 0) throw notFound();
      }
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'people.department.saved',
        actor: { userId: access.userId, membershipId: access.membershipId },
        ...(id ? { target: { type: 'department', id } } : {}),
      });
    });
    return this.departments(access);
  }

  async teamList(access: AccessContext) {
    const { rows, members, depts } = await this.database.withTenant(
      access.tenantId,
      async (tx) => ({
        rows: await tx.select().from(teams).orderBy(asc(teams.nameEn)),
        members: await tx.select().from(teamMembers),
        depts: await tx.select().from(departments),
      }),
    );
    const names = await this.namesOf(access, [
      ...members.map((m) => m.membershipId),
      ...rows.flatMap((r) => (r.leadMembershipId ? [r.leadMembershipId] : [])),
    ]);
    return {
      items: rows.map((r) => {
        const d = depts.find((x) => x.id === r.departmentId);
        return {
          id: r.id,
          name: { en: r.nameEn, ar: r.nameAr },
          department: d ? { id: d.id, name: { en: d.nameEn, ar: d.nameAr } } : null,
          lead: r.leadMembershipId
            ? { membershipId: r.leadMembershipId, name: names.get(r.leadMembershipId) ?? '' }
            : null,
          members: members
            .filter((m) => m.teamId === r.id && names.has(m.membershipId))
            .map((m) => ({ membershipId: m.membershipId, name: names.get(m.membershipId) ?? '' }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          archived: r.archivedAt !== null,
        };
      }),
    };
  }

  async saveTeam(
    req: Request,
    access: AccessContext,
    id: string | null,
    input: {
      nameEn?: string | undefined;
      nameAr?: string | undefined;
      departmentId?: string | null | undefined;
      leadMembershipId?: string | null | undefined;
      archived?: boolean | undefined;
    },
  ) {
    if (!hasPermission(access.permissions, 'people.org.manage', 'company')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.assertRefs(tx, {
        departmentId: input.departmentId,
        managerMembershipId: input.leadMembershipId,
      });
      const values = {
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.leadMembershipId !== undefined
          ? { leadMembershipId: input.leadMembershipId }
          : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      };
      if (id === null) {
        await tx.insert(teams).values({
          tenantId: access.tenantId,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          ...values,
        });
      } else {
        const updated = await tx.update(teams).set(values).where(eq(teams.id, id)).returning();
        if (updated.length === 0) throw notFound();
      }
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'people.team.saved',
        actor: { userId: access.userId, membershipId: access.membershipId },
        ...(id ? { target: { type: 'team', id } } : {}),
      });
    });
    return this.teamList(access);
  }

  async setTeamMembers(req: Request, access: AccessContext, teamId: string, memberIds: string[]) {
    if (!hasPermission(access.permissions, 'people.org.manage', 'company')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      const [team] = await tx.select().from(teams).where(eq(teams.id, teamId));
      if (!team) throw notFound();
      const wanted = [...new Set(memberIds)];
      if (wanted.length > 0) {
        const active = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(inArray(memberships.id, wanted), eq(memberships.status, 'active')));
        if (active.length !== wanted.length) throw invalid('memberIds', 'not_found');
      }
      await tx.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      if (wanted.length > 0)
        await tx
          .insert(teamMembers)
          .values(
            wanted.map((membershipId) => ({ tenantId: access.tenantId, teamId, membershipId })),
          );
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'people.team.members_changed',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'team', id: teamId },
        details: { count: wanted.length },
      });
    });
    return this.teamList(access);
  }

  async orgChart(access: AccessContext) {
    const { items } = await this.list(access, {});
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select({ id: employees.membershipId, manager: employees.managerMembershipId })
        .from(employees)
        .where(ne(employees.status, 'left')),
    );
    const managers = new Map(rows.map((r) => [r.id, r.manager]));
    return {
      nodes: items
        .filter((i) => i.status !== 'left')
        .map((i) => ({
          membershipId: i.membershipId,
          name: i.name,
          jobTitle: i.jobTitle,
          managerMembershipId: managers.get(i.membershipId) ?? null,
        })),
    };
  }

  // --- mapping -------------------------------------------------------------------------------

  private async refsFor(tx: TenantTransaction, rows: EmployeeRow[]) {
    const depts = await tx.select().from(departments);
    const ids = rows.map((r) => r.membershipId);
    const memberTeams = ids.length
      ? await tx
          .select({ membershipId: teamMembers.membershipId, team: teams })
          .from(teamMembers)
          .innerJoin(teams, eq(teams.id, teamMembers.teamId))
          .where(and(inArray(teamMembers.membershipId, ids), isNull(teams.archivedAt)))
      : [];
    return { depts, memberTeams };
  }

  private toSummary(
    r: EmployeeRow,
    names: Map<string, string>,
    refs: Awaited<ReturnType<PeopleService['refsFor']>>,
  ): EmployeeSummary {
    const d = refs.depts.find((x) => x.id === r.departmentId);
    return {
      membershipId: r.membershipId,
      number: r.number,
      name: names.get(r.membershipId) ?? '',
      jobTitle: { en: r.jobTitleEn, ar: r.jobTitleAr },
      department: d ? { id: d.id, name: { en: d.nameEn, ar: d.nameAr } } : null,
      teams: refs.memberTeams
        .filter((m) => m.membershipId === r.membershipId)
        .map((m) => ({ id: m.team.id, name: { en: m.team.nameEn, ar: m.team.nameAr } })),
      manager: r.managerMembershipId
        ? { membershipId: r.managerMembershipId, name: names.get(r.managerMembershipId) ?? '' }
        : null,
      status: r.status,
    };
  }

  private async toEmployee(
    tx: TenantTransaction,
    access: AccessContext,
    r: EmployeeRow,
  ): Promise<Employee> {
    const refs = await this.refsFor(tx, [r]);
    const [member] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.id, r.membershipId));
    const ids = [r.membershipId, ...(r.managerMembershipId ? [r.managerMembershipId] : [])];
    const names = await this.namesOf(access, ids, tx);
    const [user] = member ? await this.identity.userSummaries([member.userId]) : [];
    const details = this.canSeeDetails(access, r);
    const manage = this.canManage(access) && r.status !== 'left';
    const restricted = this.canSeeRestricted(access, r.membershipId);
    return {
      ...this.toSummary(r, names, refs),
      email: details ? (user?.email ?? '') : '',
      details: details
        ? {
            employmentType: r.employmentType,
            joinDate: r.joinDate,
            leaveDate: r.leaveDate,
            weeklyHours: r.weeklyHours.replace(/\.?0+$/, ''),
            workDays: r.workDays,
          }
        : null,
      canSeeRestricted: restricted,
      nextStatuses: this.canManage(access) ? [...EMPLOYEE_TRANSITIONS[r.status]] : [],
      actions: [
        ...(manage ? (['edit', 'status', 'documents', 'checklist'] as const) : []),
        ...(restricted &&
        r.status !== 'left' &&
        (this.canManage(access) || r.membershipId === access.membershipId)
          ? (['private'] as const)
          : []),
      ],
      version: r.version,
    };
  }

  private async namesOf(access: AccessContext, membershipIds: string[], tx?: TenantTransaction) {
    const unique = [...new Set(membershipIds)];
    if (unique.length === 0) return new Map<string, string>();
    const load = (t: TenantTransaction) =>
      t
        .select({ id: memberships.id, userId: memberships.userId })
        .from(memberships)
        .where(inArray(memberships.id, unique));
    const rows = tx ? await load(tx) : await this.database.withTenant(access.tenantId, load);
    const users = await this.userNames(rows.map((r) => r.userId));
    return new Map(
      rows.flatMap((r) =>
        users.has(r.userId) ? [[r.id, users.get(r.userId) ?? ''] as const] : [],
      ),
    );
  }

  private async userNames(userIds: string[]) {
    return new Map(
      (await this.identity.userSummaries([...new Set(userIds)])).map((u) => [u.id, u.name]),
    );
  }

  private history(
    tx: TenantTransaction,
    access: AccessContext,
    membershipId: string,
    kind: string,
    changes: Record<string, { from: unknown; to: unknown }>,
  ) {
    return tx.insert(employeeHistory).values({
      tenantId: access.tenantId,
      membershipId,
      kind,
      changes,
      changedByUserId: access.userId,
    });
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    membershipId: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target: { type: 'employee', id: membershipId },
      ...(details ? { details } : {}),
    });
  }
}
