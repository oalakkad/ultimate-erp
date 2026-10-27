import { type Request } from 'express';

/**
 * The client's IP address from the TCP connection. X-Forwarded-For is deliberately ignored:
 * anyone can send it. It will be honoured only once deployment configures a trusted proxy.
 */
export function clientIp(req: Request): string {
  return req.socket.remoteAddress ?? 'unknown';
}
