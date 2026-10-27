import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RateLimitedError } from '../rate-limit/rate-limiter.js';
import { toErrorResponse } from './to-error-response.js';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(GlobalExceptionFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    // Always a string: set by requestIdMiddleware before any handler runs.
    const requestId = typeof req.id === 'string' ? req.id : 'unknown';

    const { status, body, unexpected } = toErrorResponse(exception, requestId);
    if (unexpected) {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    if (res.headersSent) return;
    if (exception instanceof RateLimitedError) {
      res.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    res.status(status).json(body);
  }
}
