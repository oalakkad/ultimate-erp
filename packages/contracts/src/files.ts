import { z } from 'zod';

// Files (docs/modules/files-monitoring.md §2).

export const FILE_STATUSES = ['pending', 'clean', 'infected', 'scan_failed'] as const;

export const fileSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int().positive(),
    /** pending = being scanned; only `clean` files can be downloaded. */
    status: z.enum(FILE_STATUSES),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type FileInfo = z.infer<typeof fileSchema>;

export const fileIdParamSchema = z.object({ id: z.uuid() }).strict();

/** A signed link, valid for `expiresInSeconds`, that downloads the file as an attachment. */
export const fileDownloadResponseSchema = z
  .object({ url: z.url(), expiresInSeconds: z.number().int().positive() })
  .strict();
