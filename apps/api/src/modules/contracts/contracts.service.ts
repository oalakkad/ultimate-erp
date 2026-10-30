import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type Contract,
  type ContractAction,
  type ContractStatus,
  type ContractSummary,
  type ContractTemplate,
  type contractListQuerySchema,
  type createContractRequestSchema,
  hasPermission,
  type newVersionRequestSchema,
  type NotificationType,
  type Permission,
  renderTemplate,
  type templateRequestSchema,
  type templateUpdateSchema,
  type updateContractRequestSchema,
} from '@ultimate-erp/contracts';
import {
  clients,
  contracts,
  contractTemplates,
  contractVersions,
  files,
  membershipRoles,
  memberships,
  type TenantTransaction,
  tenants,
} from '@ultimate-erp/db';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
} from 'drizzle-orm';
import { type Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Job } from 'pg-boss';
import { type z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { nextDocumentNumber } from '../../platform/database/numbering.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { DOWNLOAD_URL_SECONDS, ObjectStorage } from '../../platform/files/object-storage.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { IdentityService } from '../identity/identity.service.js';

type ContractRow = typeof contracts.$inferSelect;
type TemplateRow = typeof contractTemplates.$inferSelect;

const PREFIX = { contract: 'CT', engagement_letter: 'EL' } as const;
const EXPIRING_SOON_DAYS = 60;

const notFound = () => new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
const invalid = (path: string, code: string) =>
  new AppError(
    'VALIDATION_FAILED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    messageFor('VALIDATION_FAILED'),
    [{ path, code }],
  );
const conflict = (path: string, code: string, message: string) =>
  new AppError('CONFLICT', HttpStatus.CONFLICT, message, [{ path, code }]);
const forbidden = (message: string) => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, message);

/** Today's date in Kuwait (UTC+3, no daylight saving) as YYYY-MM-DD. */
export function kuwaitToday(now = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const addDays = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Where each action may start, the state it leads to, and the permission it needs. */
const TRANSITIONS: Record<
  Exclude<ContractAction, 'edit'>,
  { from: ContractStatus[]; to: ContractStatus; permission: Permission }
> = {
  submit: { from: ['draft'], to: 'in_review', permission: 'contracts.contract.manage' },
  approve: { from: ['in_review'], to: 'approved', permission: 'contracts.contract.approve' },
  reject: { from: ['in_review'], to: 'draft', permission: 'contracts.contract.approve' },
  send: { from: ['approved'], to: 'sent', permission: 'contracts.contract.manage' },
  sign: { from: ['sent'], to: 'signed', permission: 'contracts.contract.manage' },
  activate: { from: ['signed'], to: 'active', permission: 'contracts.contract.manage' },
  terminate: {
    from: ['signed', 'active'],
    to: 'terminated',
    permission: 'contracts.contract.manage',
  },
};

const toTemplate = (row: TemplateRow): ContractTemplate => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  bodyEn: row.bodyEn,
  bodyAr: row.bodyAr,
  archived: row.archivedAt !== null,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
});

/** Contracts & engagement letters (docs/modules/contracts.md). */
@Injectable()
export class ContractsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly identity: IdentityService,
    private readonly notifier: Notifier,
    private readonly storage: ObjectStorage,
  ) {}

  // --- templates -----------------------------------------------------------------------------

  async templates(access: AccessContext): Promise<ContractTemplate[]> {
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx.select().from(contractTemplates).orderBy(asc(contractTemplates.name)),
    );
    return rows.map(toTemplate);
  }

  async createTemplate(
    req: Request,
    access: AccessContext,
    input: z.output<typeof templateRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .insert(contractTemplates)
        .values({ tenantId: access.tenantId, ...input })
        .returning();
      if (!row) throw new Error('template insert returned nothing');
      await this.record(tx, req, access, 'contracts.template.created', {
        type: 'contract_template',
        id: row.id,
      });
      return toTemplate(row);
    });
  }

  async updateTemplate(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof templateUpdateSchema> & { archived?: boolean },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(contractTemplates)
        .where(eq(contractTemplates.id, id))
        .for('update');
      if (!current) throw notFound();
      if (current.version !== input.version) {
        throw conflict('version', 'stale', 'The template was changed by someone else.');
      }
      const { archived } = input;
      const fields = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'version' && key !== 'archived'),
      );
      const [row] = await tx
        .update(contractTemplates)
        .set({
          ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
          ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
          version: current.version + 1,
        })
        .where(eq(contractTemplates.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, 'contracts.template.updated', {
        type: 'contract_template',
        id,
      });
      return toTemplate(row);
    });
  }

  // --- contracts -----------------------------------------------------------------------------

  async list(access: AccessContext, query: z.output<typeof contractListQuerySchema>) {
    const today = kuwaitToday();
    const conditions: (SQL | undefined)[] = [
      query.status ? eq(contracts.status, query.status) : undefined,
      query.kind ? eq(contracts.kind, query.kind) : undefined,
      query.clientId ? eq(contracts.clientId, query.clientId) : undefined,
      query.cursor ? lt(contracts.id, query.cursor) : undefined,
    ];
    if (query.expiringWithinDays) {
      conditions.push(
        eq(contracts.status, 'active'),
        gte(contracts.endDate, today),
        lte(contracts.endDate, addDays(today, query.expiringWithinDays)),
      );
    }
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        or(
          ilike(contracts.number, pattern),
          ilike(contracts.titleEn, pattern),
          ilike(contracts.titleAr, pattern),
          ilike(clients.legalNameEn, pattern),
          ilike(clients.legalNameAr, pattern),
        ),
      );
    }
    if (query.cursor && !/^[0-9a-f-]{36}$/i.test(query.cursor)) throw invalid('cursor', 'invalid');
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx
        .select({ contract: contracts, client: clients })
        .from(contracts)
        .innerJoin(clients, eq(clients.id, contracts.clientId))
        .where(and(...conditions))
        .orderBy(desc(contracts.id))
        .limit(query.limit + 1),
    );
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(({ contract, client }) => this.toSummary(contract, client)),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.contract.id ?? null) : null,
    };
  }

  async get(access: AccessContext, id: string): Promise<Contract> {
    return this.database.withTenant(access.tenantId, async (tx) =>
      this.toContract(tx, access, await this.find(tx, id)),
    );
  }

  async create(
    req: Request,
    access: AccessContext,
    input: z.output<typeof createContractRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [client] = await tx.select().from(clients).where(eq(clients.id, input.clientId));
      if (!client || client.archivedAt) throw invalid('clientId', 'not_found');
      let template: TemplateRow | undefined;
      if (input.templateId) {
        [template] = await tx
          .select()
          .from(contractTemplates)
          .where(eq(contractTemplates.id, input.templateId));
        if (!template || template.archivedAt) throw invalid('templateId', 'not_found');
        if (template.kind !== input.kind) throw invalid('templateId', 'wrong_kind');
      }
      const number = await nextDocumentNumber(tx, access.tenantId, input.kind, PREFIX[input.kind]);
      const [row] = await tx
        .insert(contracts)
        .values({
          tenantId: access.tenantId,
          kind: input.kind,
          number,
          clientId: input.clientId,
          templateId: input.templateId ?? null,
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          valueAmount: input.valueAmount ?? null,
          currency: input.currency ?? 'KWD',
          paymentTerms: input.paymentTerms ?? null,
          renewalNoticeDays: input.renewalNoticeDays ?? 30,
          createdByUserId: access.userId,
        })
        .returning();
      if (!row) throw new Error('contract insert returned nothing');
      let contract = row;
      if (template) {
        const [company] = await tx.select().from(tenants);
        const values = (locale: 'en' | 'ar') => ({
          'client.name': locale === 'ar' ? client.legalNameAr : client.legalNameEn,
          'client.number': client.number,
          'document.number': number,
          'document.title': locale === 'ar' ? row.titleAr : row.titleEn,
          start_date: row.startDate ?? '',
          end_date: row.endDate ?? '',
          value: row.valueAmount ? `${row.valueAmount} ${row.currency}` : '',
          payment_terms: row.paymentTerms ?? '',
          'company.name': (locale === 'ar' ? company?.nameAr : company?.nameEn) ?? '',
          today: kuwaitToday(),
        });
        contract = await this.addVersion(tx, access, row, {
          bodyEn: renderTemplate(template.bodyEn, values('en')),
          bodyAr: renderTemplate(template.bodyAr, values('ar')),
          changeNote: template.name,
        });
      }
      await this.record(
        tx,
        req,
        access,
        'contracts.contract.created',
        { type: 'contract', id: row.id },
        { number },
      );
      return this.toContract(tx, access, contract);
    });
  }

  /** Terms can change only while the document is a draft. */
  async update(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof updateContractRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.find(tx, id, true);
      this.assertDraft(current);
      if (current.version !== input.version) {
        throw conflict('version', 'stale', 'The document was changed by someone else.');
      }
      const changes = Object.fromEntries(
        Object.entries(input).filter(([k, v]) => k !== 'version' && v !== undefined),
      );
      const merged = { ...current, ...changes };
      if (merged.startDate && merged.endDate && merged.endDate < merged.startDate)
        throw invalid('endDate', 'before_start');
      const [row] = await tx
        .update(contracts)
        .set({ ...changes, version: current.version + 1 })
        .where(eq(contracts.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(
        tx,
        req,
        access,
        'contracts.contract.updated',
        { type: 'contract', id },
        { fields: Object.keys(changes) },
      );
      return this.toContract(tx, access, row);
    });
  }

  async versions(access: AccessContext, id: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, id);
      return tx
        .select()
        .from(contractVersions)
        .where(eq(contractVersions.contractId, id))
        .orderBy(desc(contractVersions.versionNo));
    });
    const names = await this.namesOf(rows.map((r) => r.createdByUserId));
    return rows.map((v) => ({
      versionNo: v.versionNo,
      bodyEn: v.bodyEn,
      bodyAr: v.bodyAr,
      changeNote: v.changeNote,
      authorName: names.get(v.createdByUserId) ?? null,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  async newVersion(
    req: Request,
    access: AccessContext,
    id: string,
    input: z.output<typeof newVersionRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.find(tx, id, true);
      this.assertDraft(current);
      const row = await this.addVersion(tx, access, current, input);
      await this.record(
        tx,
        req,
        access,
        'contracts.contract.version_added',
        { type: 'contract', id },
        { versionNo: row.currentVersion },
      );
      return this.toContract(tx, access, row);
    });
  }

  /** Every status change goes through here: allowed source state, permission, separation of duties. */
  async transition(
    req: Request,
    access: AccessContext,
    id: string,
    action: Exclude<ContractAction, 'edit'>,
    payload: {
      reason?: string | undefined;
      fileId?: string | undefined;
      signedOn?: string | undefined;
    } = {},
  ): Promise<Contract> {
    const rule = TRANSITIONS[action];
    if (!hasPermission(access.permissions, rule.permission))
      throw forbidden('You cannot do this to a contract.');
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.find(tx, id, true);
      if (!rule.from.includes(current.status)) {
        throw conflict(
          'status',
          'invalid_transition',
          `A ${current.status} document cannot be "${action}".`,
        );
      }
      const now = new Date();
      const set: Partial<ContractRow> = { status: rule.to, version: current.version + 1 };
      if (action === 'submit') {
        if (current.currentVersion === 0) throw invalid('body', 'missing');
        Object.assign(set, {
          submittedByUserId: access.userId,
          approvedByUserId: null,
          approvedAt: null,
          reviewNote: null,
        });
      }
      if (action === 'approve' || action === 'reject') {
        // Separation of duties: the person who submitted cannot decide.
        if (current.submittedByUserId === access.userId)
          throw forbidden('You cannot approve or reject what you submitted.');
        if (action === 'approve')
          Object.assign(set, { approvedByUserId: access.userId, approvedAt: now });
        else Object.assign(set, { reviewNote: payload.reason ?? null, submittedByUserId: null });
      }
      if (action === 'send') set.sentAt = now;
      if (action === 'sign') {
        const [file] = await tx
          .select({ id: files.id, status: files.status })
          .from(files)
          .where(
            and(eq(files.id, payload.fileId ?? ''), eq(files.uploadedByUserId, access.userId)),
          );
        if (!file) throw invalid('fileId', 'not_found');
        if (file.status === 'infected') throw invalid('fileId', 'infected');
        Object.assign(set, {
          signedFileId: file.id,
          signedAt: payload.signedOn ? new Date(`${payload.signedOn}T12:00:00Z`) : now,
        });
      }
      if (action === 'activate') set.activatedAt = now;
      if (action === 'terminate')
        Object.assign(set, { terminatedAt: now, terminationReason: payload.reason ?? null });

      const [row] = await tx.update(contracts).set(set).where(eq(contracts.id, id)).returning();
      if (!row) throw notFound();
      const past = {
        submit: 'submitted',
        approve: 'approved',
        reject: 'rejected',
        send: 'sent',
        sign: 'signed',
        activate: 'activated',
        terminate: 'terminated',
      }[action];
      await this.record(
        tx,
        req,
        access,
        `contracts.contract.${past}`,
        { type: 'contract', id },
        payload.reason ? { reason: payload.reason } : undefined,
      );

      const notice = (type: NotificationType, recipients: string[]) =>
        this.notifier.notify(tx, req, {
          tenantId: access.tenantId,
          type,
          recipients: recipients.filter((r) => r !== access.userId),
          params: { number: row.number, title: row.titleEn, titleAr: row.titleAr },
          link: `/contracts/${row.id}`,
          actor: { userId: access.userId, membershipId: access.membershipId },
        });
      if (action === 'submit') await notice('contracts.submitted', await this.approvers(tx));
      if ((action === 'approve' || action === 'reject') && current.submittedByUserId) {
        await notice(action === 'approve' ? 'contracts.approved' : 'contracts.rejected', [
          current.submittedByUserId,
        ]);
      }
      return this.toContract(tx, access, row);
    });
  }

  async signedCopyDownload(req: Request, access: AccessContext, id: string) {
    const file = await this.database.withTenant(access.tenantId, async (tx) => {
      const contract = await this.find(tx, id);
      if (!contract.signedFileId) throw notFound();
      const [row] = await tx.select().from(files).where(eq(files.id, contract.signedFileId));
      if (!row) throw notFound();
      if (row.status !== 'clean')
        throw new AppError('FILE_NOT_READY', HttpStatus.CONFLICT, messageFor('FILE_NOT_READY'));
      await this.record(
        tx,
        req,
        access,
        'files.file.downloaded',
        { type: 'file', id: row.id },
        { contractId: id },
      );
      return row;
    });
    const url = await this.storage.downloadUrl(file.storageKey, file.displayName, file.contentType);
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  /** Dashboard numbers (only for people who may read contracts). */
  async dashboardCounts(tx: TenantTransaction) {
    const today = kuwaitToday();
    const active = await tx
      .select({ id: contracts.id, endDate: contracts.endDate })
      .from(contracts)
      .where(eq(contracts.status, 'active'));
    const limit = addDays(today, EXPIRING_SOON_DAYS);
    return {
      active: active.length,
      expiringSoon: active.filter(
        (c) => c.endDate !== null && c.endDate >= today && c.endDate <= limit,
      ).length,
    };
  }

  // --- helpers -------------------------------------------------------------------------------

  private async addVersion(
    tx: TenantTransaction,
    access: AccessContext,
    contract: ContractRow,
    input: { bodyEn: string; bodyAr: string; changeNote?: string | undefined },
  ): Promise<ContractRow> {
    const versionNo = contract.currentVersion + 1;
    await tx.insert(contractVersions).values({
      tenantId: access.tenantId,
      contractId: contract.id,
      versionNo,
      bodyEn: input.bodyEn,
      bodyAr: input.bodyAr,
      changeNote: input.changeNote ?? null,
      createdByUserId: access.userId,
    });
    const [row] = await tx
      .update(contracts)
      .set({ currentVersion: versionNo, version: contract.version + 1 })
      .where(eq(contracts.id, contract.id))
      .returning();
    if (!row) throw notFound();
    return row;
  }

  private assertDraft(contract: ContractRow) {
    if (contract.status !== 'draft') {
      throw conflict(
        'status',
        'not_draft',
        'Only a draft can be changed. Reject it back to draft first.',
      );
    }
  }

  private async find(tx: TenantTransaction, id: string, lock = false): Promise<ContractRow> {
    const query = tx.select().from(contracts).where(eq(contracts.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    return row;
  }

  private toSummary(row: ContractRow, client: typeof clients.$inferSelect): ContractSummary {
    return {
      id: row.id,
      kind: row.kind,
      number: row.number,
      title: { en: row.titleEn, ar: row.titleAr },
      client: {
        id: client.id,
        number: client.number,
        name: { en: client.legalNameEn, ar: client.legalNameAr },
      },
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      valueAmount: row.valueAmount,
      currency: row.currency,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async toContract(
    tx: TenantTransaction,
    access: AccessContext,
    row: ContractRow,
  ): Promise<Contract> {
    const [client] = await tx.select().from(clients).where(eq(clients.id, row.clientId));
    if (!client) throw notFound();
    const [signedFile] = row.signedFileId
      ? await tx.select().from(files).where(eq(files.id, row.signedFileId))
      : [];
    const names = await this.namesOf(
      [row.submittedByUserId, row.approvedByUserId].filter((v): v is string => Boolean(v)),
    );
    const person = (id: string | null) =>
      id && names.has(id) ? { name: names.get(id) ?? '' } : null;
    return {
      ...this.toSummary(row, client),
      paymentTerms: row.paymentTerms,
      renewalNoticeDays: row.renewalNoticeDays,
      currentVersion: row.currentVersion,
      submittedBy: person(row.submittedByUserId),
      approvedBy: person(row.approvedByUserId),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      sentAt: row.sentAt?.toISOString() ?? null,
      signedAt: row.signedAt?.toISOString() ?? null,
      signedFile: signedFile
        ? {
            id: signedFile.id,
            name: signedFile.displayName,
            contentType: signedFile.contentType,
            sizeBytes: signedFile.sizeBytes,
            status: signedFile.status,
            createdAt: signedFile.createdAt.toISOString(),
          }
        : null,
      activatedAt: row.activatedAt?.toISOString() ?? null,
      terminatedAt: row.terminatedAt?.toISOString() ?? null,
      terminationReason: row.terminationReason,
      actions: this.actionsFor(row, access),
      version: row.version,
    };
  }

  /** What this person may do next — the same rules `transition` enforces. */
  private actionsFor(row: ContractRow, access: AccessContext): ContractAction[] {
    const may = (p: Permission) => hasPermission(access.permissions, p);
    const out: ContractAction[] = [];
    if (row.status === 'draft' && may('contracts.contract.manage')) out.push('edit');
    for (const [action, rule] of Object.entries(TRANSITIONS) as [
      Exclude<ContractAction, 'edit'>,
      (typeof TRANSITIONS)['submit'],
    ][]) {
      if (!rule.from.includes(row.status) || !may(rule.permission)) continue;
      if ((action === 'approve' || action === 'reject') && row.submittedByUserId === access.userId)
        continue;
      if (action === 'submit' && row.currentVersion === 0) continue;
      out.push(action);
    }
    return out;
  }

  /** Owners and CEOs (who hold the approve permission today). */
  private async approvers(tx: TenantTransaction): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .where(
        and(eq(memberships.status, 'active'), inArray(membershipRoles.role, ['owner', 'ceo'])),
      );
    return rows.map((r) => r.userId);
  }

  private async namesOf(userIds: string[]): Promise<Map<string, string>> {
    return new Map(
      (await this.identity.userSummaries([...new Set(userIds)])).map((u) => [u.id, u.name]),
    );
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    action: string,
    target: { type: string; id: string },
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target,
      ...(details ? { details } : {}),
    });
  }
}

/**
 * Daily job (08:00 Kuwait): in each company separately, expire active contracts whose end date
 * has passed, and remind once before the end date (renewal_notice_days).
 */
@Injectable()
export class ContractsDailyHandler {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    @InjectPinoLogger(ContractsDailyHandler.name) private readonly logger: PinoLogger,
  ) {}

  async handle(
    job: Pick<Job, 'id'>,
    now = new Date(),
  ): Promise<{ expired: number; reminded: number }> {
    const today = kuwaitToday(now);
    let expired = 0;
    let reminded = 0;
    for (const tenantId of await this.database.activeTenantIds()) {
      const result = await this.database.withTenant(tenantId, async (tx) => {
        const leaders = await tx
          .selectDistinct({ userId: memberships.userId })
          .from(memberships)
          .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
          .where(
            and(eq(memberships.status, 'active'), inArray(membershipRoles.role, ['owner', 'ceo'])),
          );
        const audience = (c: ContractRow) => [
          ...new Set([c.createdByUserId, ...leaders.map((l) => l.userId)]),
        ];
        const tell = (type: NotificationType, c: ContractRow) =>
          this.notifier.notifySystem(tx, job.id, {
            tenantId,
            type,
            recipients: audience(c),
            params: {
              number: c.number,
              title: c.titleEn,
              titleAr: c.titleAr,
              endDate: c.endDate ?? '',
            },
            link: `/contracts/${c.id}`,
          });

        const ended = await tx
          .update(contracts)
          .set({ status: 'expired' })
          .where(and(eq(contracts.status, 'active'), lt(contracts.endDate, today)))
          .returning();
        for (const c of ended) {
          await this.audit.recordSystem(tx, job.id, {
            tenantId,
            action: 'contracts.contract.expired',
            target: { type: 'contract', id: c.id },
          });
          await tell('contracts.expired', c);
        }

        const due = await tx
          .select()
          .from(contracts)
          .where(
            and(
              eq(contracts.status, 'active'),
              isNull(contracts.renewalNotifiedAt),
              gte(contracts.endDate, today),
            ),
          );
        const toRemind = due.filter(
          (c) => c.endDate !== null && c.endDate <= addDays(today, c.renewalNoticeDays),
        );
        for (const c of toRemind) {
          await tx.update(contracts).set({ renewalNotifiedAt: now }).where(eq(contracts.id, c.id));
          await tell('contracts.renewal_due', c);
        }
        return { expired: ended.length, reminded: toRemind.length };
      });
      expired += result.expired;
      reminded += result.reminded;
    }
    this.logger.info({ jobId: job.id, expired, reminded }, 'Daily contract check done');
    return { expired, reminded };
  }
}
