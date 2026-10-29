import { connect } from 'node:net';
import { type Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/** The scanner could not give an answer (down, timed out, or replied with an error). */
export class ScannerUnavailableError extends Error {
  override readonly name = 'ScannerUnavailableError';
}

const CHUNK = 64 * 1024;
const TIMEOUT_MS = 60_000;

/**
 * ClamAV over its `clamd` TCP protocol (INSTREAM): the file is streamed in length-prefixed
 * chunks, clamd answers `stream: OK` or `stream: <signature> FOUND`. Anything else is treated
 * as "no answer" — never as clean.
 */
@Injectable()
export class VirusScanner {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  scan(content: Readable): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.config.CLAMAV_PORT, this.config.CLAMAV_HOST);
      let reply = '';
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        content.destroy();
        reject(new ScannerUnavailableError(reason));
      };
      socket.setTimeout(TIMEOUT_MS, () => {
        fail('timeout');
      });
      socket.on('error', (err: NodeJS.ErrnoException) => {
        fail(err.code ?? 'socket error');
      });
      socket.on('data', (data) => (reply += data.toString('utf8')));
      socket.on('end', () => {
        if (settled) return;
        settled = true;
        const answer = reply.replace(/\0/g, '').trim();
        if (answer === 'stream: OK') resolve({ clean: true });
        else if (/^stream: .+ FOUND$/.test(answer)) {
          resolve({ clean: false, signature: answer.slice(8, -6) });
        } else reject(new ScannerUnavailableError('unexpected reply'));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        content.on('data', (chunk: Buffer) => {
          for (let i = 0; i < chunk.length; i += CHUNK) {
            const part = chunk.subarray(i, i + CHUNK);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(part.length);
            socket.write(Buffer.concat([size, part]));
          }
        });
        content.on('end', () => socket.write(Buffer.alloc(4))); // zero length = end of stream
        content.on('error', () => {
          fail('read error');
        });
      });
    });
  }
}
