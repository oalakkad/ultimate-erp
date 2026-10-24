import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { errorResponseSchema } from '@ultimate-erp/contracts';
import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { toErrorResponse } from './to-error-response.js';

describe('toErrorResponse', () => {
  it('maps Nest HTTP exceptions to stable codes', () => {
    expect(toErrorResponse(new NotFoundException(), 'r1')).toMatchObject({
      status: 404,
      unexpected: false,
      body: { error: { code: 'NOT_FOUND', requestId: 'r1' } },
    });
    expect(toErrorResponse(new ForbiddenException(), 'r1').body.error.code).toBe('FORBIDDEN');
  });

  it('keeps the code, message and details of an AppError', () => {
    const mapped = toErrorResponse(
      new AppError('VALIDATION_FAILED', 422, 'Invalid fields', [{ path: 'email', code: 'format' }]),
      'r2',
    );
    expect(mapped.status).toBe(422);
    expect(mapped.body.error).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Invalid fields',
      requestId: 'r2',
      details: [{ path: 'email', code: 'format' }],
    });
  });

  it('hides the message of unexpected errors and flags them for logging', () => {
    const mapped = toErrorResponse(new Error('password for db is hunter2'), 'r3');
    expect(mapped.status).toBe(500);
    expect(mapped.unexpected).toBe(true);
    expect(mapped.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(mapped.body)).not.toContain('hunter2');
  });

  it('always produces a body that matches the shared contract', () => {
    for (const exception of [new NotFoundException(), new Error('x'), 'a string', null]) {
      expect(errorResponseSchema.safeParse(toErrorResponse(exception, 'r4').body).success).toBe(
        true,
      );
    }
  });
});
