/** Error code from a pg error, possibly wrapped by Drizzle (`err.cause`). */
function errorCode(err: unknown): string | undefined {
  for (
    let e: unknown = err;
    typeof e === 'object' && e !== null;
    e = (e as { cause?: unknown }).cause
  ) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

const HINTS: Record<string, string> = {
  ECONNREFUSED:
    'Cannot reach the database. Is Docker Desktop running? Start the services with: pnpm services:up',
  ENOTFOUND:
    'The database host name in .env could not be found. Check the DATABASE_* URLs in .env.',
  '28P01':
    'The database rejected the password. Check the DATABASE_* URLs in .env against .env.example.',
  '3D000': 'The database does not exist. Check POSTGRES_DB and the DATABASE_* URLs in .env.',
  '42P01': 'A table is missing — migrations have not run. Run: pnpm db:setup',
};

/** Runs a CLI task; known problems print one plain sentence instead of a stack trace. */
export async function runCli(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    const code = errorCode(err);
    const hint = code ? HINTS[code] : undefined;
    if (!hint) throw err;
    process.stderr.write(`\n${hint}\n(error code: ${code})\n\n`);
    process.exit(1);
  }
}
