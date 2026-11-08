import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CLIENT_ACTIVITY_ACTIONS,
  type Client,
  type ClientSummary,
  clientNameKey,
  type Contact,
  type createClientRequestSchema,
  type contactRequestSchema,
  type contactUpdateSchema,
  type FileInfo,
  type Interaction,
  type interactionRequestSchema,
  POSSIBLE_DUPLICATE,
  type clientListQuerySchema,
  type updateClientRequestSchema,
} from '@ultimate-erp/contracts';
import {
  auditEvents,
  clientContacts,
  clientDocuments,
  clientInteractions,
  clients,
  files,
  memberships,
  type TenantTransaction,
} from '@ultimate-erp/db';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { type Request } from 'express';
import { type z } from 'zod';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { nextDocumentNumber } from '../../platform/database/numbering.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { DOWNLOAD_URL_SECONDS, ObjectStorage } from '../../platform/files/object-storage.js';
import { type AccessContext } from '../access/access-context.js';
import { IdentityService } from '../identity/identity.service.js';

type CreateInput = z.output<typeof createClientRequestSchema>;
type UpdateInput = z.output<typeof updateClientRequestSchema>;
type ListQuery = z.output<typeof clientListQuerySchema>;
type ClientRow = typeof clients.$inferSelect;

const FOREIGN_KEY_VIOLATION = '23503';
const EXPORT_LIMIT = 5000;
const ACTIVITY_LIMIT = 50;

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

/** `name_key` holds the English and Arabic keys: "<en>|<ar>". */
const nameKeyOf = (en: string, ar: string) => `${clientNameKey(en)}|${clientNameKey(ar)}`;

/** ILIKE pattern that matches `text` literally (no wildcards from the user). */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const SORT_COLUMNS = {
  name: clients.legalNameEn,
  nameAr: clients.legalNameAr,
  created: clients.createdAt,
  updated: clients.updatedAt,
  number: clients.number,
} as const;

function encodeCursor(value: string, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString('base64url');
}
function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((v) => typeof v === 'string')
    ) {
      return parsed as [string, string];
    }
  } catch {
    // fall through
  }
  throw invalid('cursor', 'invalid');
}

const toSummary = (row: ClientRow): ClientSummary => ({
  id: row.id,
  number: row.number,
  legalName: { en: row.legalNameEn, ar: row.legalNameAr },
  type: row.type,
  status: row.status,
  archived: row.archivedAt !== null,
  commercialRegistration: row.commercialRegistration,
  city: row.city,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toContact = (row: typeof clientContacts.$inferSelect): Contact => ({
  id: row.id,
  name: row.name,
  position: row.position,
  email: row.email,
  phone: row.phone,
  isPrimary: row.isPrimary,
  isAuthorizedRepresentative: row.isAuthorizedRepresentative,
  archived: row.archivedAt !== null,
});

const toFile = (row: typeof files.$inferSelect): FileInfo => ({
  id: row.id,
  name: row.displayName,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

/** A spreadsheet cell: quoted, and never interpreted as a formula by Excel (CSV injection). */
export function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Clients / CRM (docs/modules/clients.md). Every call runs in the company's own transaction. */
@Injectable()
export class ClientsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly identity: IdentityService,
    private readonly storage: ObjectStorage,
  ) {}

  // --- clients -------------------------------------------------------------------------------

  async list(access: AccessContext, query: ListQuery) {
    const column = SORT_COLUMNS[query.sort];
    const order = query.dir === 'asc' ? asc : desc;
    const conditions: (SQL | undefined)[] = [
      query.archived === 'true' ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
      query.status ? eq(clients.status, query.status) : undefined,
    ];
    if (query.search) {
      const pattern = containsPattern(query.search);
      conditions.push(
        or(
          ilike(clients.legalNameEn, pattern),
          ilike(clients.legalNameAr, pattern),
          ilike(clients.number, pattern),
          ilike(clients.commercialRegistration, pattern),
          ilike(clients.email, pattern),
        ),
      );
    }
    if (query.cursor) {
      const [value, id] = decodeCursor(query.cursor);
      const typed =
        column === clients.createdAt || column === clients.updatedAt ? new Date(value) : value;
      const beyond = query.dir === 'asc' ? gt : lt;
      conditions.push(or(beyond(column, typed), and(eq(column, typed), beyond(clients.id, id))));
    }
    const { rows, extras } = await this.database.withTenant(access.tenantId, async (tx) => {
      const found = await tx
        .select()
        .from(clients)
        .where(and(...conditions))
        .orderBy(order(column), order(clients.id))
        .limit(query.limit + 1);
      return { rows: found, extras: await this.cardExtras(tx, found.slice(0, query.limit)) };
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const sortValue = (row: ClientRow) => {
      const v =
        row[
          query.sort === 'name'
            ? 'legalNameEn'
            : query.sort === 'nameAr'
              ? 'legalNameAr'
              : query.sort === 'created'
                ? 'createdAt'
                : query.sort === 'updated'
                  ? 'updatedAt'
                  : 'number'
        ];
      return v instanceof Date ? v.toISOString() : v;
    };
    return {
      items: page.map((row) => ({
        ...toSummary(row),
        industry: row.industry,
        accountManagerName: extras.managers.get(row.id) ?? null,
        primaryContact: extras.contacts.get(row.id) ?? null,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(sortValue(last), last.id) : null,
    };
  }

  async get(access: AccessContext, id: string): Promise<Client> {
    return this.database.withTenant(access.tenantId, async (tx) =>
      this.toClient(tx, await this.find(tx, id)),
    );
  }

  async create(req: Request, access: AccessContext, input: CreateInput): Promise<Client> {
    const nameKey = nameKeyOf(input.legalNameEn, input.legalNameAr);
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        if (!input.confirmDuplicate) await this.assertNoSimilarName(tx, nameKey);
        if (input.accountManagerMembershipId)
          await this.assertActiveMember(tx, input.accountManagerMembershipId);
        const number = await nextDocumentNumber(tx, access.tenantId, 'client', 'C');
        const [row] = await tx
          .insert(clients)
          .values({
            tenantId: access.tenantId,
            number,
            type: input.type ?? 'company',
            legalNameEn: input.legalNameEn,
            legalNameAr: input.legalNameAr,
            nameKey,
            commercialRegistration: input.commercialRegistration ?? null,
            industry: input.industry ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            website: input.website ?? null,
            addressLine: input.addressLine ?? null,
            city: input.city ?? null,
            country: input.country ?? 'KW',
            status: input.status ?? 'prospect',
            accountManagerMembershipId: input.accountManagerMembershipId ?? null,
            createdByUserId: access.userId,
          })
          .returning();
        if (!row) throw new Error('client insert returned nothing');
        await this.record(tx, req, access, row.id, 'clients.client.created', { number });
        return this.toClient(tx, row);
      });
    } catch (err) {
      throw this.duplicateRegistration(err);
    }
  }

  async update(
    req: Request,
    access: AccessContext,
    id: string,
    input: UpdateInput,
  ): Promise<Client> {
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const current = await this.find(tx, id, true);
        if (current.version !== input.version) {
          throw conflict(
            'version',
            'stale',
            'The client was changed by someone else. Reload and try again.',
          );
        }
        const changes = Object.fromEntries(
          Object.entries(input).filter(([key]) => key !== 'version'),
        ) as Omit<UpdateInput, 'version'>;
        if (changes.accountManagerMembershipId)
          await this.assertActiveMember(tx, changes.accountManagerMembershipId);
        const changed = Object.entries(changes)
          .filter(
            ([key, value]) => value !== undefined && current[key as keyof ClientRow] !== value,
          )
          .map(([key]) => key);
        const legalNameEn = changes.legalNameEn ?? current.legalNameEn;
        const legalNameAr = changes.legalNameAr ?? current.legalNameAr;
        const [row] = await tx
          .update(clients)
          .set({
            ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
            nameKey: nameKeyOf(legalNameEn, legalNameAr),
            version: current.version + 1,
          })
          .where(eq(clients.id, id))
          .returning();
        if (!row) throw notFound();
        if (changed.length > 0) {
          await this.record(tx, req, access, id, 'clients.client.updated', { fields: changed });
        }
        return this.toClient(tx, row);
      });
    } catch (err) {
      throw this.duplicateRegistration(err);
    }
  }

  async setArchived(
    req: Request,
    access: AccessContext,
    id: string,
    archived: boolean,
  ): Promise<Client> {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const current = await this.find(tx, id, true);
      if ((current.archivedAt !== null) === archived) return this.toClient(tx, current);
      const [row] = await tx
        .update(clients)
        .set({ archivedAt: archived ? new Date() : null, version: current.version + 1 })
        .where(eq(clients.id, id))
        .returning();
      if (!row) throw notFound();
      await this.record(
        tx,
        req,
        access,
        id,
        archived ? 'clients.client.archived' : 'clients.client.restored',
      );
      return this.toClient(tx, row);
    });
  }

  /** CSV of the clients matching the list filters (max 5,000), Excel-friendly (UTF-8 BOM). */
  async exportCsv(req: Request, access: AccessContext, query: ListQuery): Promise<string> {
    const { items } = await this.list(access, { ...query, limit: EXPORT_LIMIT, cursor: undefined });
    await this.database.withTenant(access.tenantId, (tx) =>
      this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'clients.client.exported',
        actor: { userId: access.userId, membershipId: access.membershipId },
        details: { rows: items.length },
      }),
    );
    const header = [
      'Number',
      'Legal name (EN)',
      'Legal name (AR)',
      'Type',
      'Status',
      'Commercial registration',
      'City',
      'Archived',
      'Created',
    ];
    const lines = items.map((c) =>
      [
        c.number,
        c.legalName.en,
        c.legalName.ar,
        c.type,
        c.status,
        c.commercialRegistration,
        c.city,
        c.archived ? 'yes' : 'no',
        c.createdAt,
      ]
        .map(csvCell)
        .join(','),
    );
    return `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
  }

  // --- contacts ------------------------------------------------------------------------------

  async contacts(access: AccessContext, clientId: string): Promise<Contact[]> {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      const rows = await tx
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, clientId))
        .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.name));
      return rows.map(toContact);
    });
  }

  async addContact(
    req: Request,
    access: AccessContext,
    clientId: string,
    input: z.output<typeof contactRequestSchema>,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      if (input.isPrimary) await this.clearPrimary(tx, clientId);
      const [row] = await tx
        .insert(clientContacts)
        .values({
          tenantId: access.tenantId,
          clientId,
          name: input.name,
          position: input.position ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          isPrimary: input.isPrimary ?? false,
          isAuthorizedRepresentative: input.isAuthorizedRepresentative ?? false,
        })
        .returning();
      if (!row) throw new Error('contact insert returned nothing');
      await this.record(tx, req, access, clientId, 'clients.contact.added', { contactId: row.id });
      return toContact(row);
    });
  }

  async updateContact(
    req: Request,
    access: AccessContext,
    clientId: string,
    contactId: string,
    input: z.output<typeof contactUpdateSchema> & { archived?: boolean },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      const [current] = await tx
        .select()
        .from(clientContacts)
        .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)));
      if (!current) throw notFound();
      if (input.isPrimary) await this.clearPrimary(tx, clientId);
      const { archived, ...fields } = input;
      const [row] = await tx
        .update(clientContacts)
        .set({
          ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
          ...(archived === undefined
            ? {}
            : {
                archivedAt: archived ? new Date() : null,
                ...(archived ? { isPrimary: false } : {}),
              }),
        })
        .where(eq(clientContacts.id, contactId))
        .returning();
      if (!row) throw notFound();
      await this.record(
        tx,
        req,
        access,
        clientId,
        archived ? 'clients.contact.archived' : 'clients.contact.updated',
        {
          contactId,
        },
      );
      return toContact(row);
    });
  }

  // --- communication history ------------------------------------------------------------------

  async interactions(access: AccessContext, clientId: string): Promise<Interaction[]> {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      return tx
        .select({ interaction: clientInteractions, contactName: clientContacts.name })
        .from(clientInteractions)
        .leftJoin(clientContacts, eq(clientContacts.id, clientInteractions.contactId))
        .where(eq(clientInteractions.clientId, clientId))
        .orderBy(desc(clientInteractions.occurredAt), desc(clientInteractions.id))
        .limit(200);
    });
    const names = await this.namesOf(rows.map((r) => r.interaction.createdByUserId));
    return rows.map(({ interaction: i, contactName }) => ({
      id: i.id,
      kind: i.kind,
      occurredAt: i.occurredAt.toISOString(),
      summary: i.summary,
      contact: i.contactId && contactName ? { id: i.contactId, name: contactName } : null,
      authorName: names.get(i.createdByUserId) ?? null,
    }));
  }

  async logInteraction(
    req: Request,
    access: AccessContext,
    clientId: string,
    input: z.output<typeof interactionRequestSchema>,
  ): Promise<Interaction> {
    try {
      const id = await this.database.withTenant(access.tenantId, async (tx) => {
        await this.find(tx, clientId);
        const [row] = await tx
          .insert(clientInteractions)
          .values({
            tenantId: access.tenantId,
            clientId,
            contactId: input.contactId ?? null,
            kind: input.kind,
            occurredAt: new Date(input.occurredAt),
            summary: input.summary,
            createdByUserId: access.userId,
          })
          .returning({ id: clientInteractions.id });
        if (!row) throw new Error('interaction insert returned nothing');
        await this.record(tx, req, access, clientId, 'clients.interaction.logged', {
          interactionId: row.id,
          kind: input.kind,
        });
        return row.id;
      });
      const all = await this.interactions(access, clientId);
      const created = all.find((i) => i.id === id);
      if (!created) throw new Error('interaction not readable after insert');
      return created;
    } catch (err) {
      // The contact must belong to this client (composite foreign key).
      if (pgErrorCode(err) === FOREIGN_KEY_VIOLATION) throw invalid('contactId', 'not_found');
      throw err;
    }
  }

  // --- documents -----------------------------------------------------------------------------

  async documents(access: AccessContext, clientId: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      return tx
        .select({ link: clientDocuments, file: files })
        .from(clientDocuments)
        .innerJoin(files, eq(files.id, clientDocuments.fileId))
        .where(eq(clientDocuments.clientId, clientId))
        .orderBy(desc(clientDocuments.createdAt));
    });
    const names = await this.namesOf(rows.map((r) => r.link.addedByUserId));
    return rows.map(({ link, file }) => ({
      file: toFile(file),
      addedAt: link.createdAt.toISOString(),
      addedByName: names.get(link.addedByUserId) ?? null,
    }));
  }

  /** Attaches a file I uploaded (any scan state; it can be downloaded once clean). */
  async attachDocument(req: Request, access: AccessContext, clientId: string, fileId: string) {
    try {
      await this.database.withTenant(access.tenantId, async (tx) => {
        await this.find(tx, clientId);
        const [file] = await tx
          .select({ id: files.id, status: files.status })
          .from(files)
          .where(and(eq(files.id, fileId), eq(files.uploadedByUserId, access.userId)));
        if (!file) throw invalid('fileId', 'not_found');
        if (file.status === 'infected') throw invalid('fileId', 'infected');
        await tx
          .insert(clientDocuments)
          .values({ tenantId: access.tenantId, clientId, fileId, addedByUserId: access.userId });
        await this.record(tx, req, access, clientId, 'clients.document.attached', { fileId });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION) {
        throw conflict('fileId', 'already_attached', 'This file is already attached to a client.');
      }
      throw err;
    }
    return this.documents(access, clientId);
  }

  async detachDocument(req: Request, access: AccessContext, clientId: string, fileId: string) {
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      const removed = await tx
        .delete(clientDocuments)
        .where(and(eq(clientDocuments.clientId, clientId), eq(clientDocuments.fileId, fileId)))
        .returning({ fileId: clientDocuments.fileId });
      if (removed.length === 0) throw notFound();
      await this.record(tx, req, access, clientId, 'clients.document.detached', { fileId });
    });
  }

  /** Anyone who may read the client may download its clean documents (5-minute signed link). */
  async documentDownload(req: Request, access: AccessContext, clientId: string, fileId: string) {
    const file = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      const [row] = await tx
        .select({ file: files })
        .from(clientDocuments)
        .innerJoin(files, eq(files.id, clientDocuments.fileId))
        .where(and(eq(clientDocuments.clientId, clientId), eq(clientDocuments.fileId, fileId)));
      if (!row) throw notFound();
      if (row.file.status !== 'clean') {
        throw new AppError('FILE_NOT_READY', HttpStatus.CONFLICT, messageFor('FILE_NOT_READY'));
      }
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'files.file.downloaded',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'file', id: fileId },
        details: { clientId },
      });
      return row.file;
    });
    const url = await this.storage.downloadUrl(file.storageKey, file.displayName, file.contentType);
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  // --- activity ------------------------------------------------------------------------------

  async activity(access: AccessContext, clientId: string) {
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      await this.find(tx, clientId);
      return tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetType, 'client'),
            eq(auditEvents.targetId, clientId),
            inArray(auditEvents.action, [...CLIENT_ACTIVITY_ACTIONS]),
          ),
        )
        .orderBy(desc(auditEvents.id))
        .limit(ACTIVITY_LIMIT);
    });
    const names = await this.namesOf(rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])));
    return {
      items: rows.map((r) => {
        const fields = (r.details as { fields?: unknown }).fields;
        return {
          id: r.id,
          action: r.action as (typeof CLIENT_ACTIVITY_ACTIONS)[number],
          occurredAt: r.occurredAt.toISOString(),
          actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
          fields: Array.isArray(fields)
            ? fields.filter((f): f is string => typeof f === 'string')
            : [],
        };
      }),
    };
  }

  // --- helpers -------------------------------------------------------------------------------

  private async find(tx: TenantTransaction, id: string, lock = false): Promise<ClientRow> {
    const query = tx.select().from(clients).where(eq(clients.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw notFound();
    return row;
  }

  /** Account manager names and primary contacts for one page of the list (two queries). */
  private async cardExtras(tx: TenantTransaction, page: ClientRow[]) {
    const managers = new Map<string, string>();
    const contacts = new Map<string, string>();
    if (page.length === 0) return { managers, contacts };
    const ids = page.map((r) => r.id);
    const memberIds = [
      ...new Set(page.map((r) => r.accountManagerMembershipId).filter((x): x is string => !!x)),
    ];
    if (memberIds.length > 0) {
      const members = await tx
        .select({ id: memberships.id, userId: memberships.userId })
        .from(memberships)
        .where(inArray(memberships.id, memberIds));
      const users = new Map(
        (await this.identity.userSummaries(members.map((m) => m.userId))).map((u) => [
          u.id,
          u.name,
        ]),
      );
      const byMember = new Map(members.map((m) => [m.id, users.get(m.userId)]));
      for (const r of page) {
        const name = r.accountManagerMembershipId && byMember.get(r.accountManagerMembershipId);
        if (name) managers.set(r.id, name);
      }
    }
    const primaries = await tx
      .select({ clientId: clientContacts.clientId, name: clientContacts.name })
      .from(clientContacts)
      .where(
        and(
          inArray(clientContacts.clientId, ids),
          eq(clientContacts.isPrimary, true),
          isNull(clientContacts.archivedAt),
        ),
      );
    for (const c of primaries) if (!contacts.has(c.clientId)) contacts.set(c.clientId, c.name);
    return { managers, contacts };
  }

  private async toClient(tx: TenantTransaction, row: ClientRow): Promise<Client> {
    let accountManager: Client['accountManager'] = null;
    if (row.accountManagerMembershipId) {
      const [member] = await tx
        .select({ id: memberships.id, userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.id, row.accountManagerMembershipId));
      const [user] = member ? await this.identity.userSummaries([member.userId]) : [];
      if (member && user) accountManager = { membershipId: member.id, name: user.name };
    }
    return {
      ...toSummary(row),
      industry: row.industry,
      email: row.email,
      phone: row.phone,
      website: row.website,
      addressLine: row.addressLine,
      country: row.country,
      accountManager,
      version: row.version,
    };
  }

  private async assertNoSimilarName(tx: TenantTransaction, nameKey: string) {
    const [en = '', ar = ''] = nameKey.split('|');
    const [match] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(
        or(
          en ? sql`split_part(${clients.nameKey}, '|', 1) = ${en}` : undefined,
          ar ? sql`split_part(${clients.nameKey}, '|', 2) = ${ar}` : undefined,
        ),
      )
      .limit(1);
    if (match) {
      throw conflict(
        'legalNameEn',
        POSSIBLE_DUPLICATE,
        'A client with a very similar name already exists.',
      );
    }
  }

  private async assertActiveMember(tx: TenantTransaction, membershipId: string) {
    const [member] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.status, 'active')));
    if (!member) throw invalid('accountManagerMembershipId', 'not_found');
  }

  private async clearPrimary(tx: TenantTransaction, clientId: string) {
    await tx
      .update(clientContacts)
      .set({ isPrimary: false })
      .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)));
  }

  private duplicateRegistration(err: unknown): unknown {
    let constraint: unknown;
    for (
      let e: unknown = err;
      typeof e === 'object' && e !== null;
      e = (e as { cause?: unknown }).cause
    ) {
      constraint ??= (e as { constraint?: unknown }).constraint;
    }
    if (pgErrorCode(err) === UNIQUE_VIOLATION && constraint === 'clients_tenant_cr_key') {
      return conflict(
        'commercialRegistration',
        'duplicate',
        'Another client has this commercial registration number.',
      );
    }
    return err;
  }

  private async namesOf(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    return new Map((await this.identity.userSummaries(unique)).map((u) => [u.id, u.name]));
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    clientId: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target: { type: 'client', id: clientId },
      ...(details ? { details } : {}),
    });
  }
}
