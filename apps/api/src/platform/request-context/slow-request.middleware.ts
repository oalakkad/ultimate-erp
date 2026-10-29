import { type NextFunction, type Request, type Response } from 'express';

export interface SlowRequestLog {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  requestId: string | undefined;
}

/**
 * Logs requests slower than `thresholdMs` (architecture §7b). Logs the route pattern
 * (`/api/v1/files/:id`), never the real path or query string, which can carry IDs or tokens.
 */
export function slowRequestMiddleware(thresholdMs: number, log: (entry: SlowRequestLog) => void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (durationMs < thresholdMs) return;
      const pattern = (req.route as { path?: string } | undefined)?.path;
      log({
        method: req.method,
        route: pattern ? `${req.baseUrl}${pattern}` : '(unmatched)',
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        requestId: typeof req.id === 'string' ? req.id : undefined,
      });
    });
    next();
  };
}
