import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/**
 * `GET /api/v1/health` — readiness: can this API instance serve traffic?
 * HTTP 200 when every check is up, 503 otherwise. Deliberately reveals no
 * versions, hostnames or error text.
 */
export const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'error']),
    checks: z
      .object({
        database: z
          .object({
            status: dependencyStatusSchema,
            latencyMs: z.number().int().nonnegative().optional(),
          })
          .strict(),
      })
      .strict(),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** `GET /api/v1/health/live` — liveness: the process is running. No dependency checks. */
export const livenessResponseSchema = z.object({ status: z.literal('ok') }).strict();
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
