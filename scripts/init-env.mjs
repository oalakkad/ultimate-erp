// Creates .env from .env.example on first run. On later runs, appends variables that were
// added to .env.example since, without changing any existing value.
import { appendFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';

const keysOf = (text) =>
  new Map(
    text
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example (local development values).');
} else {
  const example = keysOf(readFileSync('.env.example', 'utf8'));
  const current = keysOf(readFileSync('.env', 'utf8'));
  const missing = [...example].filter(([key]) => !current.has(key));
  if (missing.length > 0) {
    appendFileSync(
      '.env',
      `\n# Added from .env.example\n${missing.map(([k, v]) => `${k}=${v}`).join('\n')}\n`,
    );
    console.log(`Added to .env: ${missing.map(([k]) => k).join(', ')}`);
  }
  const appUser = current.get('DATABASE_URL')?.match(/^postgres(?:ql)?:\/\/([^:@/]+)/)?.[1];
  if (appUser && appUser !== 'erp_app') {
    console.warn(
      `Warning: DATABASE_URL in .env connects as "${appUser}". The API only works as "erp_app" ` +
        '(see .env.example). Update DATABASE_URL in .env.',
    );
  }
}
