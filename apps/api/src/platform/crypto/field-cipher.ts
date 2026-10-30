import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';

const VERSION = 'f1';
const b64 = (buf: Buffer) => buf.toString('base64url');

/**
 * Encrypts sensitive personal fields at rest (docs/modules/people.md §2). AES-256-GCM with a key
 * derived from DATA_ENCRYPTION_KEY; the company ID is bound in as associated data, so a sealed
 * value copied to another company's row does not open. `lookupHash` gives a keyed, one-way value
 * for uniqueness checks (e.g. civil ID) without storing the value itself.
 */
@Injectable()
export class FieldCipher {
  private readonly key: Buffer;
  private readonly hashKey: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(hkdfSync('sha256', config.DATA_ENCRYPTION_KEY, '', 'erp:field:v1', 32));
    this.hashKey = Buffer.from(
      hkdfSync('sha256', config.DATA_ENCRYPTION_KEY, '', 'erp:field-lookup:v1', 32),
    );
  }

  seal(tenantId: string, value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(tenantId, 'utf8'));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [VERSION, b64(iv), b64(body), b64(cipher.getAuthTag())].join('.');
  }

  /** Throws if the value was altered, sealed for another company or with another key. */
  open(tenantId: string, sealed: string): unknown {
    const [version, iv, body, tag] = sealed.split('.');
    if (version !== VERSION || !iv || !body || !tag) throw new Error('Unknown sealed format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(tenantId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const text = Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(text) as unknown;
  }

  /** Keyed hash of a normalised value, scoped to one company. */
  lookupHash(tenantId: string, value: string): string {
    return createHmac('sha256', this.hashKey)
      .update(`${tenantId}:${value.normalize('NFKC').replace(/\s+/g, '').toUpperCase()}`)
      .digest('base64url');
  }
}

@Global()
@Module({ providers: [FieldCipher], exports: [FieldCipher] })
export class FieldCipherModule {}
