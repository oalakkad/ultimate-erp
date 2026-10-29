import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { type FileInfo } from '@ultimate-erp/contracts';
import { files, type TenantTransaction } from '@ultimate-erp/db';
import { and, eq } from 'drizzle-orm';
import { type Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Job } from 'pg-boss';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { allowedContentType, displayNameOf } from '../../platform/files/file-types.js';
import { DOWNLOAD_URL_SECONDS, ObjectStorage } from '../../platform/files/object-storage.js';
import { ScannerUnavailableError, VirusScanner } from '../../platform/files/virus-scanner.js';
import { JobQueue } from '../../platform/jobs/job-queue.js';
import { type AccessContext } from '../access/access-context.js';

/** The part of a multer upload we use. */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/** Job data: IDs only. The worker reads everything else from the company's own rows. */
export interface FileScanJob {
  tenantId: string;
  fileId: string;
}

const notFound = () => new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));

const toDto = (row: typeof files.$inferSelect): FileInfo => ({
  id: row.id,
  name: row.displayName,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
});

/** Upload, look up and hand out files (docs/modules/files-monitoring.md §2). */
@Injectable()
export class FilesService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly storage: ObjectStorage,
    private readonly jobs: JobQueue,
    private readonly audit: AuditLog,
  ) {}

  async upload(req: Request, access: AccessContext, upload: UploadedFile | undefined) {
    if (!upload || upload.size === 0) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.UNPROCESSABLE_ENTITY, 'No file.', [
        { path: 'file', code: 'required' },
      ]);
    }
    const name = displayNameOf(upload.originalname);
    const contentType = await allowedContentType(upload.buffer, name);
    if (!contentType) {
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'This kind of file is not allowed.',
      );
    }
    const id = await this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          tenantId: access.tenantId,
          uploadedByUserId: access.userId,
          displayName: name,
          contentType,
          sizeBytes: upload.size,
          sha256: createHash('sha256').update(upload.buffer).digest('hex'),
          // Random object name under the company's prefix; never derived from the file name.
          storageKey: `tenants/${access.tenantId}/files/${randomUUID()}`,
        })
        .returning({ id: files.id, storageKey: files.storageKey });
      if (!row) throw new Error('file insert returned nothing');
      // Stored before the transaction commits: if storing fails, no record or job remains.
      await this.storage.put(row.storageKey, upload.buffer, contentType);
      await this.jobs.enqueue(tx, 'file.scan', {
        tenantId: access.tenantId,
        fileId: row.id,
      } satisfies FileScanJob);
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'files.file.uploaded',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'file', id: row.id },
        details: { contentType, sizeBytes: upload.size },
      });
      return row.id;
    });
    return this.get(access, id);
  }

  async get(access: AccessContext, id: string): Promise<FileInfo> {
    return this.database.withTenant(access.tenantId, async (tx) =>
      toDto(await this.readable(tx, access, id)),
    );
  }

  async downloadUrl(req: Request, access: AccessContext, id: string) {
    const row = await this.database.withTenant(access.tenantId, async (tx) => {
      const found = await this.readable(tx, access, id);
      if (found.status !== 'clean') {
        throw new AppError('FILE_NOT_READY', HttpStatus.CONFLICT, messageFor('FILE_NOT_READY'));
      }
      await this.audit.record(tx, req, {
        tenantId: access.tenantId,
        action: 'files.file.downloaded',
        actor: { userId: access.userId, membershipId: access.membershipId },
        target: { type: 'file', id },
      });
      return found;
    });
    const url = await this.storage.downloadUrl(row.storageKey, row.displayName, row.contentType);
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  }

  /**
   * Until modules attach files to their records, a file is readable by its uploader only.
   * Anyone else — in this company or another — gets 404 (no hint that it exists).
   */
  private async readable(tx: TenantTransaction, access: AccessContext, id: string) {
    const [row] = await tx
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.uploadedByUserId, access.userId)));
    if (!row) throw notFound();
    return row;
  }
}

/** Worker side: scans one upload inside its own company's context. */
@Injectable()
export class FileScanHandler {
  constructor(
    private readonly database: TenantDatabase,
    private readonly storage: ObjectStorage,
    private readonly scanner: VirusScanner,
    private readonly audit: AuditLog,
    @InjectPinoLogger(FileScanHandler.name) private readonly logger: PinoLogger,
  ) {}

  async handle(job: Job<FileScanJob>, final: boolean): Promise<void> {
    const { tenantId, fileId } = job.data;
    // The tenant comes from the job; row-level security then limits every query to it.
    const file = await this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(files).where(eq(files.id, fileId));
      return row;
    });
    if (!file || file.status !== 'pending') return; // gone, or already decided
    try {
      const result = await this.scanner.scan(await this.storage.stream(file.storageKey));
      if (!result.clean) await this.storage.delete(file.storageKey);
      await this.database.withTenant(tenantId, async (tx) => {
        await tx
          .update(files)
          .set({ status: result.clean ? 'clean' : 'infected', scannedAt: new Date() })
          .where(eq(files.id, fileId));
        if (!result.clean) {
          await this.audit.recordSystem(tx, job.id, {
            tenantId,
            action: 'files.file.infected',
            target: { type: 'file', id: fileId },
            details: { signature: result.signature },
          });
        }
      });
      this.logger.info({ jobId: job.id, fileId, clean: result.clean }, 'File scanned');
    } catch (err) {
      const reason = err instanceof ScannerUnavailableError ? err.message : 'storage';
      this.logger.warn({ jobId: job.id, fileId, reason, final }, 'File scan failed');
      if (final) {
        await this.database.withTenant(tenantId, (tx) =>
          tx
            .update(files)
            .set({ status: 'scan_failed', scannedAt: new Date() })
            .where(eq(files.id, fileId)),
        );
      }
      // No `cause` on purpose: pg-boss stores the error, and the original may hold details.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        err instanceof ScannerUnavailableError ? 'SCANNER_UNAVAILABLE' : 'STORAGE_ERROR',
      );
    }
  }
}
