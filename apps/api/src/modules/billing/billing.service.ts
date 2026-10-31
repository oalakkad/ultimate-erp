import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type BillingSettings,
  billingSettingsSchema,
  hasPermission,
  type Invoice,
  type InvoiceSummary,
} from '@ultimate-erp/contracts';
import {
  clients,
  companySettings,
  contracts,
  creditNotes,
  invoiceLines,
  invoices,
  invoiceTimeEntries,
  membershipRoles,
  memberships,
  payments,
  projects,
  tasks,
  type TenantTransaction,
  timeEntries,
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
  lte,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import { type Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Job } from 'pg-boss';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { nextDocumentNumber } from '../../platform/database/numbering.js';
import { pgErrorCode } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { filsToKwd, kwdToFils, mulDivRound } from '../payroll/engine.js';

type InvoiceRow = typeof invoices.$inferSelect;
type LineInput = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string | undefined;
  taxCode?: string | null | undefined;
};

const FOREIGN_KEY_VIOLATION = '23503';
const OPEN = ['issued', 'partially_paid'] as const;
const DEFAULT_SETTINGS: BillingSettings = { paymentTermsDays: 30, taxes: [], toVerify: true };

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
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** An exact decimal string as numerator / denominator. */
const fraction = (value: string) => {
  const [whole = '0', frac = ''] = value.split('.');
  const d = 10n ** BigInt(frac.length);
  return { n: BigInt(whole) * d + BigInt(frac || '0'), d };
};

/** One line's amount, discount and tax in fils (docs/modules/billing.md §3), half-up per value. */
export function lineTotals(line: LineInput, taxRatePercent: string | null) {
  const qty = fraction(line.quantity);
  const amount = mulDivRound(kwdToFils(line.unitPrice), qty.n, qty.d);
  const pct = fraction(line.discountPercent ?? '0');
  const discount = mulDivRound(amount, pct.n, pct.d * 100n);
  const rate = fraction(taxRatePercent ?? '0');
  const tax = mulDivRound(amount - discount, rate.n, rate.d * 100n);
  return { amount, discount, tax };
}

/** Invoicing & payments (docs/modules/billing.md). */
@Injectable()
export class BillingService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly identity: IdentityService,
    private readonly notifier: Notifier,
  ) {}

  // --- access & settings ---------------------------------------------------------------------

  private can(
    access: AccessContext,
    permission: 'billing.invoice.issue' | 'billing.payment.record',
  ) {
    return hasPermission(access.permissions, permission, 'company');
  }

  /** Company readers see all; managers see invoices of projects they manage. */
  private async readable(tx: TenantTransaction, access: AccessContext, invoice: InvoiceRow) {
    if (hasPermission(access.permissions, 'billing.invoice.read', 'company')) return true;
    if (!hasPermission(access.permissions, 'billing.invoice.read', 'project') || !invoice.projectId)
      return false;
    const [p] = await tx
      .select({ manager: projects.managerMembershipId })
      .from(projects)
      .where(eq(projects.id, invoice.projectId));
    return p?.manager === access.membershipId;
  }

  private async settingsOf(tx: TenantTransaction): Promise<BillingSettings> {
    const [row] = await tx.select().from(companySettings).where(eq(companySettings.key, 'billing'));
    const parsed = billingSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...(row?.value as object | undefined),
    });
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async settings(access: AccessContext) {
    return this.database.withTenant(access.tenantId, (tx) => this.settingsOf(tx));
  }

  async updateSettings(
    req: Request,
    access: AccessContext,
    input: {
      paymentTermsDays?: number | undefined;
      taxes?: BillingSettings['taxes'] | undefined;
      confirmVerified?: boolean | undefined;
    },
  ) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.settingsOf(tx);
      const value: BillingSettings = {
        paymentTermsDays: input.paymentTermsDays ?? current.paymentTermsDays,
        taxes: input.taxes ?? current.taxes,
        // Changing taxes needs a fresh verification.
        toVerify: input.confirmVerified ? false : input.taxes ? true : current.toVerify,
      };
      if (new Set(value.taxes.map((t) => t.code)).size !== value.taxes.length)
        throw invalid('taxes', 'duplicate');
      await tx
        .insert(companySettings)
        .values({
          tenantId: access.tenantId,
          key: 'billing',
          value,
          updatedByUserId: access.userId,
        })
        .onConflictDoUpdate({
          target: [companySettings.tenantId, companySettings.key],
          set: { value, updatedByUserId: access.userId },
        });
      await this.record(tx, req, access, 'settings', access.tenantId, 'billing.settings.updated', {
        fields: Object.keys(input),
      });
      return value;
    });
  }

  // --- invoices ------------------------------------------------------------------------------

  async list(
    access: AccessContext,
    query: {
      status?: string | undefined;
      overdue?: string | undefined;
      clientId?: string | undefined;
      projectId?: string | undefined;
      search?: string | undefined;
    },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const today = kuwaitToday();
      const conditions: (SQL | undefined)[] = [
        query.status ? eq(invoices.status, query.status as 'draft') : undefined,
        query.clientId ? eq(invoices.clientId, query.clientId) : undefined,
        query.projectId ? eq(invoices.projectId, query.projectId) : undefined,
        query.overdue === 'true'
          ? and(inArray(invoices.status, [...OPEN]), lte(invoices.dueDate, addDays(today, -1)))
          : undefined,
      ];
      if (!hasPermission(access.permissions, 'billing.invoice.read', 'company')) {
        const mine = (
          await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.managerMembershipId, access.membershipId))
        ).map((p) => p.id);
        if (mine.length === 0) return { items: [] };
        conditions.push(inArray(invoices.projectId, mine));
      }
      if (query.search) {
        const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        conditions.push(
          or(
            ilike(invoices.number, pattern),
            ilike(clients.legalNameEn, pattern),
            ilike(clients.legalNameAr, pattern),
          ),
        );
      }
      const rows = await tx
        .select({ invoice: invoices, client: clients })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(and(...conditions))
        .orderBy(desc(invoices.createdAt))
        .limit(300);
      const balances = await this.balances(
        tx,
        rows.map((r) => r.invoice.id),
      );
      return {
        items: rows.map((r) =>
          this.toSummary(r.invoice, r.client, balances.get(r.invoice.id), today),
        ),
      };
    });
  }

  async get(access: AccessContext, id: string): Promise<Invoice> {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const invoice = await this.load(tx, access, id);
      return this.toInvoice(tx, access, invoice);
    });
  }

  async create(
    req: Request,
    access: AccessContext,
    input: {
      clientId: string;
      contractId?: string | null | undefined;
      projectId?: string | null | undefined;
      notes?: string | undefined;
      lines?: LineInput[] | undefined;
    },
  ) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const [client] = await tx
          .select()
          .from(clients)
          .where(and(eq(clients.id, input.clientId), isNull(clients.archivedAt)));
        if (!client) throw invalid('clientId', 'not_found');
        const [row] = await tx
          .insert(invoices)
          .values({
            tenantId: access.tenantId,
            clientId: input.clientId,
            contractId: input.contractId ?? null,
            projectId: input.projectId ?? null,
            notes: input.notes ?? '',
            createdByUserId: access.userId,
          })
          .returning();
        if (!row) throw new Error('invoice insert returned nothing');
        const saved = await this.writeLines(tx, access, row, input.lines ?? []);
        await this.record(tx, req, access, 'invoice', row.id, 'billing.invoice.drafted');
        return this.toInvoice(tx, access, saved);
      });
    } catch (err) {
      throw this.mismatch(err);
    }
  }

  async update(
    req: Request,
    access: AccessContext,
    id: string,
    input: {
      contractId?: string | null | undefined;
      projectId?: string | null | undefined;
      notes?: string | undefined;
      lines?: LineInput[] | undefined;
      version: number;
    },
  ) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const current = await this.load(tx, access, id, true);
        if (current.status !== 'draft')
          throw conflict('status', 'not_draft', 'Only draft invoices can be edited.');
        if (current.version !== input.version)
          throw conflict('version', 'stale', 'The invoice was changed by someone else.');
        const [row] = await tx
          .update(invoices)
          .set({
            ...(input.contractId !== undefined ? { contractId: input.contractId } : {}),
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            version: current.version + 1,
          })
          .where(eq(invoices.id, id))
          .returning();
        if (!row) throw notFound();
        const saved = input.lines ? await this.writeLines(tx, access, row, input.lines) : row;
        await this.record(tx, req, access, 'invoice', id, 'billing.invoice.edited');
        return this.toInvoice(tx, access, saved);
      });
    } catch (err) {
      throw this.mismatch(err);
    }
  }

  async remove(req: Request, access: AccessContext, id: string) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    await this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (current.status !== 'draft')
        throw conflict(
          'status',
          'not_draft',
          'Issued invoices are corrected with a void or a credit note, never deleted.',
        );
      await tx.delete(invoices).where(eq(invoices.id, id));
      await this.record(tx, req, access, 'invoice', id, 'billing.invoice.draft_deleted');
    });
  }

  /** Draft from approved, billable, not-yet-invoiced time of a project. */
  async fromTime(
    req: Request,
    access: AccessContext,
    input: { projectId: string; from: string; to: string; hourlyRate: string },
  ) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId));
      if (!project) throw invalid('projectId', 'not_found');
      const billed = tx.select({ id: invoiceTimeEntries.timeEntryId }).from(invoiceTimeEntries);
      const entries = await tx
        .select({ entry: timeEntries, task: tasks })
        .from(timeEntries)
        .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .where(
          and(
            eq(timeEntries.projectId, project.id),
            eq(timeEntries.status, 'approved'),
            eq(timeEntries.billable, true),
            gte(timeEntries.workDate, input.from),
            lte(timeEntries.workDate, input.to),
            notInArray(timeEntries.id, billed),
          ),
        )
        .orderBy(asc(tasks.number), asc(timeEntries.membershipId))
        .for('update', { of: timeEntries });
      if (entries.length === 0) throw invalid('projectId', 'no_billable_time');
      const names = await this.namesOf(
        entries.map((e) => e.entry.membershipId),
        tx,
      );
      const groups = new Map<string, { label: string; hundredths: bigint; ids: string[] }>();
      for (const { entry, task } of entries) {
        const key = `${task.id}:${entry.membershipId}`;
        const [whole = '0', frac = ''] = entry.hours.split('.');
        const h = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
        const g = groups.get(key) ?? {
          label: `${task.number} ${task.title} — ${names.get(entry.membershipId) ?? ''}`,
          hundredths: 0n,
          ids: [],
        };
        g.hundredths += h;
        g.ids.push(entry.id);
        groups.set(key, g);
      }
      const [row] = await tx
        .insert(invoices)
        .values({
          tenantId: access.tenantId,
          clientId: project.clientId,
          projectId: project.id,
          contractId: project.contractId,
          notes: `${input.from} – ${input.to}`,
          createdByUserId: access.userId,
        })
        .returning();
      if (!row) throw new Error('invoice insert returned nothing');
      const lines = [...groups.values()].map((g) => ({
        description: g.label.slice(0, 500),
        quantity: `${g.hundredths / 100n}.${String(g.hundredths % 100n).padStart(2, '0')}`,
        unitPrice: input.hourlyRate,
      }));
      const saved = await this.writeLines(tx, access, row, lines);
      await tx.insert(invoiceTimeEntries).values(
        entries.map((e) => ({
          tenantId: access.tenantId,
          invoiceId: row.id,
          timeEntryId: e.entry.id,
        })),
      );
      await this.record(tx, req, access, 'invoice', row.id, 'billing.invoice.drafted_from_time', {
        entries: entries.length,
      });
      return this.toInvoice(tx, access, saved);
    });
  }

  async issue(
    req: Request,
    access: AccessContext,
    id: string,
    input: { issueDate?: string | undefined; dueDate?: string | undefined },
  ) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (current.status !== 'draft')
        throw conflict('status', 'invalid_transition', 'Only drafts are issued.');
      const [line] = await tx
        .select({ id: invoiceLines.id })
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, id))
        .limit(1);
      if (!line || kwdToFils(current.total) <= 0n) throw invalid('lines', 'empty');
      const settings = await this.settingsOf(tx);
      const issueDate = input.issueDate ?? kuwaitToday();
      const dueDate = input.dueDate ?? addDays(issueDate, settings.paymentTermsDays);
      if (dueDate < issueDate) throw invalid('dueDate', 'before_issue');
      const number = await nextDocumentNumber(tx, access.tenantId, 'invoice', 'INV');
      const [row] = await tx
        .update(invoices)
        .set({
          status: 'issued',
          number,
          issueDate,
          dueDate,
          issuedByUserId: access.userId,
          version: current.version + 1,
        })
        .where(eq(invoices.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(tx, req, access, 'invoice', id, 'billing.invoice.issued', {
        number,
        total: row.total,
      });
      // The project's manager learns that their work was invoiced.
      if (row.projectId) {
        const [manager] = await tx
          .select({ userId: memberships.userId })
          .from(projects)
          .innerJoin(memberships, eq(memberships.id, projects.managerMembershipId))
          .where(eq(projects.id, row.projectId));
        if (manager && manager.userId !== access.userId) {
          await this.notifier.notify(tx, req, {
            tenantId: access.tenantId,
            type: 'billing.issued',
            recipients: [manager.userId],
            params: { number, total: row.total },
            link: `/invoices/${id}`,
            actor: { userId: access.userId, membershipId: access.membershipId },
          });
        }
      }
      return this.toInvoice(tx, access, row);
    });
  }

  async void(req: Request, access: AccessContext, id: string, reason: string) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (!OPEN.includes(current.status as (typeof OPEN)[number]))
        throw conflict(
          'status',
          'invalid_transition',
          'Only issued, unpaid invoices can be voided.',
        );
      const { paid, credited } = (await this.balances(tx, [id])).get(id) ?? {
        paid: 0n,
        credited: 0n,
      };
      if (paid > 0n || credited > 0n)
        throw conflict(
          'status',
          'has_payments',
          'An invoice with payments or credit notes cannot be voided; issue a credit note.',
        );
      const [row] = await tx
        .update(invoices)
        .set({ status: 'void', voidReason: reason, version: current.version + 1 })
        .where(eq(invoices.id, id))
        .returning();
      if (!row) throw notFound();
      // Voiding releases the billed time so it can be invoiced again.
      await tx.delete(invoiceTimeEntries).where(eq(invoiceTimeEntries.invoiceId, id));
      await this.record(tx, req, access, 'invoice', id, 'billing.invoice.voided', { reason });
      return this.toInvoice(tx, access, row);
    });
  }

  // --- payments and credit notes -------------------------------------------------------------

  async recordPayment(
    req: Request,
    access: AccessContext,
    id: string,
    input: {
      amount: string;
      receivedOn: string;
      method: 'bank_transfer' | 'cash' | 'cheque' | 'card' | 'knet' | 'other';
      reference?: string | undefined;
    },
  ) {
    if (!this.can(access, 'billing.payment.record')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (!OPEN.includes(current.status as (typeof OPEN)[number]))
        throw conflict(
          'status',
          'not_open',
          'Payments are recorded on issued, unpaid invoices only.',
        );
      const outstanding = await this.outstanding(tx, current);
      const amount = kwdToFils(input.amount);
      if (amount <= 0n) throw invalid('amount', 'positive');
      if (amount > outstanding) throw invalid('amount', 'more_than_outstanding');
      if (input.receivedOn > kuwaitToday()) throw invalid('receivedOn', 'future');
      const [p] = await tx
        .insert(payments)
        .values({
          tenantId: access.tenantId,
          invoiceId: id,
          amount: filsToKwd(amount),
          receivedOn: input.receivedOn,
          method: input.method,
          reference: input.reference ?? '',
          recordedByUserId: access.userId,
        })
        .returning();
      await this.record(tx, req, access, 'invoice', id, 'billing.payment.recorded', {
        paymentId: p?.id,
        amount: filsToKwd(amount),
      });
      return this.toInvoice(tx, access, await this.recompute(tx, current));
    });
  }

  async reversePayment(req: Request, access: AccessContext, paymentId: string, reason: string) {
    if (!this.can(access, 'billing.payment.record')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!p) throw notFound();
      const current = await this.load(tx, access, p.invoiceId, true);
      if (p.status !== 'recorded')
        throw conflict('status', 'already_reversed', 'This payment was already reversed.');
      await tx
        .update(payments)
        .set({ status: 'reversed', reverseReason: reason })
        .where(eq(payments.id, paymentId));
      await this.record(tx, req, access, 'invoice', p.invoiceId, 'billing.payment.reversed', {
        paymentId,
        reason,
      });
      return this.toInvoice(tx, access, await this.recompute(tx, current));
    });
  }

  async creditNote(
    req: Request,
    access: AccessContext,
    id: string,
    input: { amount: string; reason: string },
  ) {
    if (!this.can(access, 'billing.invoice.issue')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.load(tx, access, id, true);
      if (!OPEN.includes(current.status as (typeof OPEN)[number]))
        throw conflict('status', 'not_open', 'Credit notes are issued against open invoices.');
      const amount = kwdToFils(input.amount);
      if (amount <= 0n) throw invalid('amount', 'positive');
      if (amount > (await this.outstanding(tx, current)))
        throw invalid('amount', 'more_than_outstanding');
      const number = await nextDocumentNumber(tx, access.tenantId, 'credit_note', 'CN');
      await tx.insert(creditNotes).values({
        tenantId: access.tenantId,
        number,
        invoiceId: id,
        amount: filsToKwd(amount),
        reason: input.reason,
        issuedOn: kuwaitToday(),
        issuedByUserId: access.userId,
      });
      await this.record(tx, req, access, 'invoice', id, 'billing.credit_note.issued', {
        number,
        amount: filsToKwd(amount),
      });
      return this.toInvoice(tx, access, await this.recompute(tx, current));
    });
  }

  // --- reports -------------------------------------------------------------------------------

  async aging(access: AccessContext) {
    if (!hasPermission(access.permissions, 'billing.invoice.read', 'company')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const today = kuwaitToday();
      const rows = await tx
        .select({ invoice: invoices, client: clients })
        .from(invoices)
        .innerJoin(clients, eq(clients.id, invoices.clientId))
        .where(inArray(invoices.status, [...OPEN]));
      const balances = await this.balances(
        tx,
        rows.map((r) => r.invoice.id),
      );
      const keys = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
      const buckets = new Map(keys.map((k) => [k, { amount: 0n, count: 0 }]));
      const byClient = new Map<
        string,
        { name: { en: string; ar: string }; outstanding: bigint; overdue: bigint }
      >();
      let total = 0n;
      for (const { invoice, client } of rows) {
        const b = balances.get(invoice.id);
        const due = kwdToFils(invoice.total) - (b?.paid ?? 0n) - (b?.credited ?? 0n);
        if (due <= 0n) continue;
        const late = invoice.dueDate ? daysBetween(invoice.dueDate, today) : 0;
        const key =
          late <= 0
            ? 'current'
            : late <= 30
              ? 'd1_30'
              : late <= 60
                ? 'd31_60'
                : late <= 90
                  ? 'd61_90'
                  : 'd90_plus';
        const bucket = buckets.get(key) ?? { amount: 0n, count: 0 };
        bucket.amount += due;
        bucket.count += 1;
        total += due;
        const c = byClient.get(client.id) ?? {
          name: { en: client.legalNameEn, ar: client.legalNameAr },
          outstanding: 0n,
          overdue: 0n,
        };
        c.outstanding += due;
        if (late > 0) c.overdue += due;
        byClient.set(client.id, c);
      }
      return {
        currency: 'KWD',
        buckets: keys.map((k) => ({
          key: k,
          amount: filsToKwd(buckets.get(k)?.amount ?? 0n),
          count: buckets.get(k)?.count ?? 0,
        })),
        total: filsToKwd(total),
        clients: [...byClient.entries()]
          .sort((a, b) => Number(b[1].outstanding - a[1].outstanding))
          .map(([id, c]) => ({
            id,
            name: c.name,
            outstanding: filsToKwd(c.outstanding),
            overdue: filsToKwd(c.overdue),
          })),
      };
    });
  }

  async revenue(access: AccessContext, year: number) {
    if (!hasPermission(access.permissions, 'billing.invoice.read', 'company')) throw forbidden();
    return this.database.withTenant(access.tenantId, async (tx) => {
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const issued = await tx
        .select({ issueDate: invoices.issueDate, total: invoices.total })
        .from(invoices)
        .where(
          and(
            notInArray(invoices.status, ['draft', 'void']),
            gte(invoices.issueDate, from),
            lte(invoices.issueDate, to),
          ),
        );
      const credits = await tx
        .select({ issuedOn: creditNotes.issuedOn, amount: creditNotes.amount })
        .from(creditNotes)
        .where(and(gte(creditNotes.issuedOn, from), lte(creditNotes.issuedOn, to)));
      const received = await tx
        .select({ on: payments.receivedOn, amount: payments.amount })
        .from(payments)
        .where(
          and(
            eq(payments.status, 'recorded'),
            gte(payments.receivedOn, from),
            lte(payments.receivedOn, to),
          ),
        );
      const months = Array.from(
        { length: 12 },
        (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`,
      );
      const sum = <T>(
        rows: T[],
        date: (r: T) => string | null,
        amount: (r: T) => string,
        month: string,
      ) =>
        rows
          .filter((r) => date(r)?.startsWith(month))
          .reduce((t, r) => t + kwdToFils(amount(r)), 0n);
      const out = months.map((m) => ({
        month: m,
        invoiced:
          sum(
            issued,
            (r) => r.issueDate,
            (r) => r.total,
            m,
          ) -
          sum(
            credits,
            (r) => r.issuedOn,
            (r) => r.amount,
            m,
          ),
        received: sum(
          received,
          (r) => r.on,
          (r) => r.amount,
          m,
        ),
      }));
      return {
        year,
        currency: 'KWD',
        months: out.map((o) => ({
          month: o.month,
          invoiced: filsToKwd(o.invoiced),
          received: filsToKwd(o.received),
        })),
        totals: {
          invoiced: filsToKwd(out.reduce((t, o) => t + o.invoiced, 0n)),
          received: filsToKwd(out.reduce((t, o) => t + o.received, 0n)),
        },
      };
    });
  }

  async dashboard(tx: TenantTransaction) {
    const today = kuwaitToday();
    const rows = await tx
      .select()
      .from(invoices)
      .where(inArray(invoices.status, [...OPEN]));
    const balances = await this.balances(
      tx,
      rows.map((r) => r.id),
    );
    let outstanding = 0n;
    let overdue = 0n;
    let overdueCount = 0;
    for (const r of rows) {
      const b = balances.get(r.id);
      const due = kwdToFils(r.total) - (b?.paid ?? 0n) - (b?.credited ?? 0n);
      outstanding += due;
      if (r.dueDate && r.dueDate < today && due > 0n) {
        overdue += due;
        overdueCount += 1;
      }
    }
    return { outstanding: filsToKwd(outstanding), overdue: filsToKwd(overdue), overdueCount };
  }

  // --- helpers -------------------------------------------------------------------------------

  private async load(tx: TenantTransaction, access: AccessContext, id: string, lock = false) {
    const query = tx.select().from(invoices).where(eq(invoices.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row || !(await this.readable(tx, access, row))) throw notFound();
    return row;
  }

  /** Replaces a draft's lines and its totals. */
  private async writeLines(
    tx: TenantTransaction,
    access: AccessContext,
    invoice: InvoiceRow,
    lines: LineInput[],
  ) {
    const settings = await this.settingsOf(tx);
    const taxes = new Map(
      settings.taxes.filter((t) => t.active).map((t) => [t.code, t.ratePercent]),
    );
    for (const l of lines)
      if (l.taxCode && !taxes.has(l.taxCode)) throw invalid('lines', 'unknown_tax');
    await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id));
    let subtotal = 0n;
    let discountTotal = 0n;
    let taxTotal = 0n;
    const values = lines.map((l, i) => {
      const t = lineTotals(l, l.taxCode ? (taxes.get(l.taxCode) ?? null) : null);
      subtotal += t.amount;
      discountTotal += t.discount;
      taxTotal += t.tax;
      return {
        tenantId: access.tenantId,
        invoiceId: invoice.id,
        position: i + 1,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent ?? '0',
        taxCode: l.taxCode ?? null,
        amount: filsToKwd(t.amount),
        discount: filsToKwd(t.discount),
        tax: filsToKwd(t.tax),
      };
    });
    if (values.length > 0) await tx.insert(invoiceLines).values(values);
    const [row] = await tx
      .update(invoices)
      .set({
        subtotal: filsToKwd(subtotal),
        discountTotal: filsToKwd(discountTotal),
        taxTotal: filsToKwd(taxTotal),
        total: filsToKwd(subtotal - discountTotal + taxTotal),
      })
      .where(eq(invoices.id, invoice.id))
      .returning();
    if (!row) throw notFound();
    return row;
  }

  private async balances(tx: TenantTransaction, ids: string[]) {
    const out = new Map<string, { paid: bigint; credited: bigint }>();
    if (ids.length === 0) return out;
    for (const p of await tx
      .select()
      .from(payments)
      .where(and(inArray(payments.invoiceId, ids), eq(payments.status, 'recorded')))) {
      const b = out.get(p.invoiceId) ?? { paid: 0n, credited: 0n };
      b.paid += kwdToFils(p.amount);
      out.set(p.invoiceId, b);
    }
    for (const c of await tx
      .select()
      .from(creditNotes)
      .where(inArray(creditNotes.invoiceId, ids))) {
      const b = out.get(c.invoiceId) ?? { paid: 0n, credited: 0n };
      b.credited += kwdToFils(c.amount);
      out.set(c.invoiceId, b);
    }
    return out;
  }

  private async outstanding(tx: TenantTransaction, invoice: InvoiceRow) {
    const b = (await this.balances(tx, [invoice.id])).get(invoice.id);
    return kwdToFils(invoice.total) - (b?.paid ?? 0n) - (b?.credited ?? 0n);
  }

  /** Status from the balance: settled → paid; anything received → partially paid; else issued. */
  private async recompute(tx: TenantTransaction, invoice: InvoiceRow) {
    const b = (await this.balances(tx, [invoice.id])).get(invoice.id) ?? { paid: 0n, credited: 0n };
    const left = kwdToFils(invoice.total) - b.paid - b.credited;
    const status =
      left <= 0n ? 'paid' : b.paid > 0n || b.credited > 0n ? 'partially_paid' : 'issued';
    const [row] = await tx
      .update(invoices)
      .set({ status, version: invoice.version + 1 })
      .where(eq(invoices.id, invoice.id))
      .returning();
    return row ?? invoice;
  }

  private toSummary(
    invoice: InvoiceRow,
    client: typeof clients.$inferSelect,
    b: { paid: bigint; credited: bigint } | undefined,
    today: string,
  ): InvoiceSummary {
    const outstanding = ['draft', 'void'].includes(invoice.status)
      ? 0n
      : kwdToFils(invoice.total) - (b?.paid ?? 0n) - (b?.credited ?? 0n);
    return {
      id: invoice.id,
      number: invoice.number,
      client: {
        id: client.id,
        number: client.number,
        name: { en: client.legalNameEn, ar: client.legalNameAr },
      },
      status: invoice.status,
      overdue:
        OPEN.includes(invoice.status as (typeof OPEN)[number]) &&
        invoice.dueDate !== null &&
        invoice.dueDate < today &&
        outstanding > 0n,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      total: invoice.total,
      outstanding: filsToKwd(outstanding),
    };
  }

  private async toInvoice(
    tx: TenantTransaction,
    access: AccessContext,
    invoice: InvoiceRow,
  ): Promise<Invoice> {
    const [client] = await tx.select().from(clients).where(eq(clients.id, invoice.clientId));
    if (!client) throw notFound();
    const [contract] = invoice.contractId
      ? await tx.select().from(contracts).where(eq(contracts.id, invoice.contractId))
      : [];
    const [project] = invoice.projectId
      ? await tx.select().from(projects).where(eq(projects.id, invoice.projectId))
      : [];
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.id))
      .orderBy(asc(invoiceLines.position));
    const pays = await tx
      .select()
      .from(payments)
      .where(eq(payments.invoiceId, invoice.id))
      .orderBy(asc(payments.createdAt));
    const credits = await tx
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.invoiceId, invoice.id))
      .orderBy(asc(creditNotes.createdAt));
    const linked = await tx
      .select({ id: invoiceTimeEntries.timeEntryId })
      .from(invoiceTimeEntries)
      .where(eq(invoiceTimeEntries.invoiceId, invoice.id));
    const balance = (await this.balances(tx, [invoice.id])).get(invoice.id);
    const summary = this.toSummary(invoice, client, balance, kuwaitToday());
    const issue = this.can(access, 'billing.invoice.issue');
    const record = this.can(access, 'billing.payment.record');
    const open = OPEN.includes(invoice.status as (typeof OPEN)[number]);
    const hasMoney = (balance?.paid ?? 0n) > 0n || (balance?.credited ?? 0n) > 0n;
    return {
      ...summary,
      contract: contract ? { id: contract.id, number: contract.number } : null,
      project: project
        ? {
            id: project.id,
            number: project.number,
            name: { en: project.nameEn, ar: project.nameAr },
          }
        : null,
      subtotal: invoice.subtotal,
      discountTotal: invoice.discountTotal,
      taxTotal: invoice.taxTotal,
      paidTotal: filsToKwd(balance?.paid ?? 0n),
      creditedTotal: filsToKwd(balance?.credited ?? 0n),
      notes: invoice.notes,
      voidReason: invoice.voidReason,
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity.replace(/\.?0+$/, ''),
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent.replace(/\.?0+$/, ''),
        taxCode: l.taxCode,
        amount: l.amount,
        discount: l.discount,
        tax: l.tax,
      })),
      timeEntries: linked.length,
      payments: pays.map((p) => ({
        id: p.id,
        amount: p.amount,
        receivedOn: p.receivedOn,
        method: p.method,
        reference: p.reference,
        source: p.source,
        status: p.status,
        reverseReason: p.reverseReason,
      })),
      creditNotes: credits.map((c) => ({
        id: c.id,
        number: c.number,
        amount: c.amount,
        reason: c.reason,
        issuedOn: c.issuedOn,
      })),
      actions: [
        ...(issue && invoice.status === 'draft' ? (['edit', 'delete', 'issue'] as const) : []),
        ...(issue && open && !hasMoney ? (['void'] as const) : []),
        ...(record && open ? (['pay'] as const) : []),
        ...(issue && open ? (['credit'] as const) : []),
      ],
      version: invoice.version,
    };
  }

  private mismatch(err: unknown): unknown {
    if (pgErrorCode(err) === FOREIGN_KEY_VIOLATION) return invalid('projectId', 'not_of_client');
    return err;
  }

  private async namesOf(membershipIds: string[], tx: TenantTransaction) {
    const unique = [...new Set(membershipIds)];
    if (unique.length === 0) return new Map<string, string>();
    const rows = await tx
      .select({ id: memberships.id, userId: memberships.userId })
      .from(memberships)
      .where(inArray(memberships.id, unique));
    const users = new Map(
      (await this.identity.userSummaries(rows.map((r) => r.userId))).map((u) => [u.id, u.name]),
    );
    return new Map(rows.map((r) => [r.id, users.get(r.userId) ?? ''] as const));
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    type: string,
    id: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target: { type, id },
      ...(details ? { details } : {}),
    });
  }
}

/** Daily 08:00 Kuwait: reminds finance staff of overdue invoices (at most once a week each). */
@Injectable()
export class BillingDailyHandler {
  constructor(
    private readonly database: TenantDatabase,
    private readonly notifier: Notifier,
    @InjectPinoLogger(BillingDailyHandler.name) private readonly logger: PinoLogger,
  ) {}

  async handle(job: Pick<Job, 'id'>, now = new Date()): Promise<{ reminded: number }> {
    const today = kuwaitToday(now);
    const weekAgo = addDays(today, -7);
    let reminded = 0;
    for (const tenantId of await this.database.activeTenantIds()) {
      reminded += await this.database.withTenant(tenantId, async (tx) => {
        const due = await tx
          .select()
          .from(invoices)
          .where(
            and(
              inArray(invoices.status, [...OPEN]),
              lte(invoices.dueDate, addDays(today, -1)),
              or(isNull(invoices.reminderSentOn), lte(invoices.reminderSentOn, weekAgo)),
            ),
          );
        if (due.length === 0) return 0;
        const staff = await tx
          .selectDistinct({ userId: memberships.userId })
          .from(memberships)
          .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
          .where(
            and(
              eq(memberships.status, 'active'),
              inArray(membershipRoles.role, ['owner', 'ceo', 'finance']),
            ),
          );
        for (const invoice of due) {
          await tx
            .update(invoices)
            .set({ reminderSentOn: today })
            .where(eq(invoices.id, invoice.id));
          await this.notifier.notifySystem(tx, job.id, {
            tenantId,
            type: 'billing.overdue',
            recipients: staff.map((s) => s.userId),
            params: { number: invoice.number ?? '', dueDate: invoice.dueDate ?? '' },
            link: `/invoices/${invoice.id}`,
          });
        }
        return due.length;
      });
    }
    this.logger.info({ reminded }, 'Daily billing check done');
    return { reminded };
  }
}
