import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn } from './columns.js';
import { memberships, tenants } from './tenancy.js';

export const FILE_STATUSES = ['pending', 'clean', 'infected', 'scan_failed'] as const;

/**
 * Uploaded files (docs/modules/files-monitoring.md §2). The bytes live in object storage under
 * `storage_key`; this row is the only way to reach them. Downloadable only when `clean`.
 */
export const files = pgTable(
  'files',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
    /** Shown to people only; never used to build paths or headers unescaped. */
    displayName: text('display_name').notNull(),
    /** Detected from the content, not from the name or the browser's claim. */
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    status: text('status', { enum: FILE_STATUSES }).notNull().default('pending'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('files_tenant_id_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'files_uploader_fk',
      columns: [t.tenantId, t.uploadedByUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    index('files_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    check(
      'files_status_valid',
      sql`${t.status} in ('pending', 'clean', 'infected', 'scan_failed')`,
    ),
    check('files_size_positive', sql`${t.sizeBytes} > 0`),
    check(
      'files_storage_key_tenant',
      sql`${t.storageKey} like 'tenants/' || ${t.tenantId} || '/%'`,
    ),
  ],
);
