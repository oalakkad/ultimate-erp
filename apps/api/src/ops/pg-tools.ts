import { spawn } from 'node:child_process';
import { type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Where pg_dump / pg_restore run (docs/operations.md §2):
 * - `local`: on this machine's PATH — the production image ships PostgreSQL 18 client tools.
 * - `container`: inside a running PostgreSQL container through `docker exec` (development and
 *   tests on machines without the client tools). Connects to that container's own server.
 */
export type PgToolsTarget = { kind: 'local' } | { kind: 'container'; containerId: string };

export class PgToolError extends Error {
  override readonly name = 'PgToolError';
}

interface Connection {
  /** URL without the password, safe to pass as an argument. */
  url: string;
  password: string;
}

/** Splits a connection URL; inside a container the server is always 127.0.0.1:5432. */
export function connectionFor(url: string, target: PgToolsTarget): Connection {
  const parsed = new URL(url);
  const password = decodeURIComponent(parsed.password);
  parsed.password = '';
  if (target.kind === 'container') {
    parsed.hostname = '127.0.0.1';
    parsed.port = '5432';
    parsed.search = '';
  }
  return { url: parsed.toString(), password };
}

function command(
  target: PgToolsTarget,
  tool: string,
  args: string[],
  stdin: boolean,
): { file: string; args: string[] } {
  if (target.kind === 'local') return { file: tool, args };
  // `-e PGPASSWORD` without a value: docker copies it from its own environment, so the
  // password never appears in a process list.
  const exec = ['exec', '-e', 'PGPASSWORD', ...(stdin ? ['-i'] : []), target.containerId];
  return { file: 'docker', args: [...exec, tool, ...args] };
}

const STDERR_LIMIT = 8 * 1024;

/**
 * Runs a PostgreSQL client tool. `input` is streamed to its stdin; its stdout is returned as a
 * stream to `output`. Rejects with the tool's own error text (never contains the password).
 */
export async function runPgTool(options: {
  target: PgToolsTarget;
  tool: 'pg_dump' | 'pg_restore' | 'psql';
  args: string[];
  password: string;
  input?: AsyncIterable<Buffer>;
  output?: (stdout: Readable) => Promise<void>;
}): Promise<void> {
  const { file, args } = command(
    options.target,
    options.tool,
    options.args,
    options.input !== undefined,
  );
  const child = spawn(file, args, {
    env: { ...process.env, PGPASSWORD: options.password },
    stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const { stdout, stderr: errors } = child;
  if (!stdout || !errors) throw new Error('could not read the tool output');
  let stderr = '';
  errors.setEncoding('utf8');
  errors.on('data', (chunk: string) => {
    if (stderr.length < STDERR_LIMIT) stderr += chunk;
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'ENOENT'
          ? new PgToolError(
              options.target.kind === 'local'
                ? `${options.tool} was not found. Install the PostgreSQL 18 client tools, or run this inside the server image.`
                : 'docker was not found. Is Docker Desktop installed and running?',
            )
          : err,
      );
    });
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });

  const work: Promise<unknown>[] = [];
  if (options.input && child.stdin) {
    const stdin = child.stdin;
    work.push(
      pipeline(options.input, stdin).catch((err: unknown) => {
        // The tool may stop reading early because it failed; its exit code tells the story.
        child.kill();
        throw err;
      }),
    );
  }
  if (options.output) work.push(options.output(stdout));
  else stdout.resume();

  const [exit, ...rest] = await Promise.allSettled([exited, ...work]);
  if (exit.status === 'rejected') throw exit.reason;
  const code = exit.value;
  if (code !== 0) {
    throw new PgToolError(
      `${options.tool} failed (exit code ${code}): ${stderr.trim() || 'no details'}`,
    );
  }
  const failed = rest.find((r) => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
