import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';

const VERSION = 'v1';
const b64 = (buf: Buffer) => buf.toString('base64url');

/**
 * Encrypts job data that must not rest readable in the database — above all email links with
 * one-time tokens, which are otherwise stored only as hashes (docs/modules/platform-jobs.md §3).
 * AES-256-GCM (tamper-evident) with a key derived from AUTH_SECRET for this purpose only.
 */
@Injectable()
export class PayloadSealer {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(hkdfSync('sha256', config.AUTH_SECRET, '', 'erp:job-payload:v1', 32));
  }

  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [VERSION, b64(iv), b64(body), b64(cipher.getAuthTag())].join('.');
  }

  /**
   * Throws if the payload was altered or sealed with another key. GCM authentication means a
   * successful open returns exactly what this server sealed.
   */
  open(sealed: string): unknown {
    const [version, iv, body, tag] = sealed.split('.');
    if (version !== VERSION || !iv || !body || !tag) throw new Error('Unknown payload format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const text = Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(text) as unknown;
  }
}
