import { type Request } from 'express';

/** Express app setting holding TRUST_PROXY_HOPS (set by `createApp`). */
export const PROXY_HOPS_SETTING = 'erp proxy hops';

/**
 * The client's IP address, used for rate limits, the audit log and sign-in notices.
 *
 * Without trusted proxies (TRUST_PROXY_HOPS=0) it is the TCP connection's address and
 * X-Forwarded-For is ignored: anyone can send that header. Behind N trusted proxies, each
 * appends the address it received from to X-Forwarded-For, so the client is the entry N hops
 * from the right (the connection itself being the last hop); entries further left were sent by
 * the client and are ignored. Express "trust proxy" is deliberately NOT used: it would also make
 * req.hostname follow X-Forwarded-Host, letting a client choose the company.
 */
export function clientIp(req: Request): string {
  const socket = req.socket.remoteAddress ?? 'unknown';
  const hops = Number(req.app.get(PROXY_HOPS_SETTING) ?? 0);
  if (!Number.isInteger(hops) || hops <= 0) return socket;
  const header = req.headers['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const chain = [...forwarded, socket];
  return chain[Math.max(0, chain.length - 1 - hops)] ?? socket;
}
