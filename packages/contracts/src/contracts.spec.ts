import { describe, expect, it } from 'vitest';
import { errorResponseSchema, healthResponseSchema } from './index.js';

describe('errorResponseSchema', () => {
  it('accepts a well-formed error', () => {
    const result = errorResponseSchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'abc' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown error codes', () => {
    const result = errorResponseSchema.safeParse({
      error: { code: 'SOMETHING_ELSE', message: 'x', requestId: 'abc' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects extra fields such as a leaked stack trace', () => {
    const result = errorResponseSchema.safeParse({
      error: { code: 'INTERNAL_ERROR', message: 'x', requestId: 'abc', stack: 'at foo()' },
    });
    expect(result.success).toBe(false);
  });
});

describe('healthResponseSchema', () => {
  it('accepts a healthy report', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      checks: { database: { status: 'up', latencyMs: 3 } },
      checkedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects extra diagnostic fields', () => {
    const result = healthResponseSchema.safeParse({
      status: 'error',
      checks: { database: { status: 'down', error: 'connection refused at 10.0.0.5' } },
      checkedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
