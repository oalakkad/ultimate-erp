import { HttpStatus } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AppError } from '../errors/app-error.js';

/** Maps Express body-parser failures (identified by `err.type`) to our error codes. */
function toAppError(err: unknown): unknown {
  const type = typeof err === 'object' && err !== null && 'type' in err ? err.type : '';
  switch (type) {
    case 'entity.parse.failed':
      return new AppError(
        'MALFORMED_JSON',
        HttpStatus.BAD_REQUEST,
        'The request body is not valid JSON.',
      );
    case 'entity.too.large':
      return new AppError(
        'PAYLOAD_TOO_LARGE',
        HttpStatus.PAYLOAD_TOO_LARGE,
        'The request body is too large.',
      );
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'The request content type or encoding is not supported.',
      );
    default:
      return err;
  }
}

/**
 * JSON body parsing with a size limit. Parser errors are converted here because
 * NestJS would otherwise turn invalid JSON into a generic BAD_REQUEST.
 */
export function jsonBodyMiddleware(limit: string) {
  const parse = express.json({ limit });
  return (req: Request, res: Response, next: NextFunction): void => {
    parse(req, res, (err?: unknown) => {
      next(err === undefined ? undefined : toAppError(err));
    });
  };
}
