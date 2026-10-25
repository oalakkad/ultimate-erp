import { z } from 'zod';

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** Reads the database URLs the CLI scripts need; prints variable names, never values. */
export function readEnv<T extends z.ZodRawShape>(shape: T): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(process.env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  process.stderr.write(`Invalid configuration:\n${problems.join('\n')}\n`);
  process.exit(1);
}

export const urls = {
  DATABASE_ADMIN_URL: postgresUrl,
  DATABASE_MIGRATOR_URL: postgresUrl,
  DATABASE_URL: postgresUrl,
};
