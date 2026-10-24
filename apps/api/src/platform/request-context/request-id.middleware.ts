import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER } from '@ultimate-erp/contracts';
import { type NextFunction, type Request, type Response } from 'express';

// Letters, digits, dot, underscore, dash; 8–128 chars. Blocks log injection via the header.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Gives every request a correlation ID before anything else runs, so even
 * requests rejected early (oversized body, bad JSON) can be traced in the logs.
 * An incoming X-Request-Id is only reused when a trusted proxy sets it.
 */
export function requestIdMiddleware(trustIncoming: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id =
      trustIncoming && typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
