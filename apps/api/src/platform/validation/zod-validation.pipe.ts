import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { type z } from 'zod';
import { AppError } from '../errors/app-error.js';

/**
 * Validates a body, query or params object against a strict schema from packages/contracts.
 * Unknown fields fail validation (prevents mass assignment such as `"role": "owner"`).
 * Errors list each field path and a machine code; values are never echoed back.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw new AppError(
      'VALIDATION_FAILED',
      HttpStatus.UNPROCESSABLE_ENTITY,
      'The request contains invalid fields.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        code: issue.code,
      })),
    );
  }
}
