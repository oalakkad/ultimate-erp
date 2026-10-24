// Scans the working tree for committed secrets with gitleaks (security.md R11). Requires Docker.
// Exit code 1 means a possible secret was found; the output shows file and rule, with the value redacted.
import { spawnSync } from 'node:child_process';

const GITLEAKS_IMAGE = 'zricethezav/gitleaks:v8.30.1';

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${process.cwd()}:/repo`,
    GITLEAKS_IMAGE,
    'dir',
    '/repo',
    '--config',
    '/repo/.gitleaks.toml',
    '--no-banner',
    '--redact',
  ],
  // Stops Git Bash on Windows from rewriting the /repo paths.
  { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);

if (result.error) {
  console.error(`Could not run Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
