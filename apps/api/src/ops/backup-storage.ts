import { type Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface StorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export interface StoredObject {
  key: string;
  size: number;
}

/** The file bucket as the backup tool sees it (same settings as the API: S3_*). */
export class BackupStorage {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(settings: StorageSettings) {
    this.bucket = settings.bucket;
    this.client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: true,
      credentials: { accessKeyId: settings.accessKey, secretAccessKey: settings.secretKey },
    });
  }

  async exists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw err;
    }
  }

  async ensureBucket(): Promise<void> {
    if (!(await this.exists())) {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  /** True when the bucket is missing or holds nothing (a safe restore target). */
  async isEmpty(): Promise<boolean> {
    if (!(await this.exists())) return true;
    const page = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }),
    );
    return (page.KeyCount ?? 0) === 0;
  }

  async *list(): AsyncGenerator<StoredObject> {
    if (!(await this.exists())) return;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key) yield { key: item.Key, size: item.Size ?? 0 };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async read(key: string): Promise<{ body: AsyncIterable<Buffer>; contentType: string }> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`Object ${key} has no content`);
    return {
      body: result.Body as Readable,
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  }

  async write(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  close(): void {
    this.client.destroy();
  }
}
