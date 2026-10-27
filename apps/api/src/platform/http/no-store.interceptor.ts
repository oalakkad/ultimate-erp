import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Response } from 'express';
import { type Observable } from 'rxjs';

/**
 * Marks every response of a controller as not cacheable — for responses with personal or
 * security data (sessions, backup codes) that must never sit in a browser or proxy cache.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}
