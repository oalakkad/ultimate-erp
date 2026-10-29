import { type Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';
import { AppError } from '../errors/app-error.js';
import { messageFor } from '../errors/to-error-response.js';

/** How long a signed download link works. */
export const DOWNLOAD_URL_SECONDS = 5 * 60;

/** `Content-Disposition` for a download: always an attachment, name safely encoded (RFC 6266). */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * S3-compatible object storage (RustFS in development; any S3 in production). Private bucket:
 * nothing is public, people only ever get short-lived signed links (security.md R8).
 */
@Injectable()
export class ObjectStorage implements OnApplicationShutdown {
  private readonly client: S3Client | undefined;
  private readonly signer: S3Client | undefined;
  private readonly bucket: string;
  private bucketReady: Promise<void> | undefined;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucket = config.S3_BUCKET;
    if (!config.S3_ENDPOINT || !config.S3_ACCESS_KEY || !config.S3_SECRET_KEY) return;
    const base = {
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    };
    this.client = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    // Links must use the address browsers can reach (may differ behind a proxy).
    this.signer = new S3Client({
      ...base,
      endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const client = await this.ready();
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async stream(key: string): Promise<Readable> {
    const client = await this.ready();
    const result = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return result.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    const client = await this.ready();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async downloadUrl(key: string, name: string, contentType: string): Promise<string> {
    await this.ready();
    if (!this.signer) throw unavailable();
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: attachmentDisposition(name),
        ResponseContentType: contentType,
      }),
      { expiresIn: DOWNLOAD_URL_SECONDS },
    );
  }

  /** Creates the bucket on first use if it does not exist (development and new installs). */
  private ready(): Promise<S3Client> {
    const client = this.client;
    if (!client) return Promise.reject(unavailable());
    this.bucketReady ??= client
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(
        () => undefined,
        async () => {
          await client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        },
      )
      .catch((err: unknown) => {
        this.bucketReady = undefined;
        throw err;
      });
    return this.bucketReady.then(() => client);
  }

  onApplicationShutdown(): void {
    this.client?.destroy();
    this.signer?.destroy();
  }
}

const unavailable = () =>
  new AppError(
    'SERVICE_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
    messageFor('SERVICE_UNAVAILABLE'),
  );
