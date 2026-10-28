// Fails if any production (shipped) dependency uses a licence outside the allow-list.
// Copyleft licences (GPL, AGPL, LGPL, SSPL, ...) need a documented review first (compliance.md §3).
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
  // MIT No Attribution: MIT without even the notice requirement (nodemailer). Reviewed 2026-10-25.
  'MIT-0',
  // SIL Open Font License: our self-hosted fonts. Commercial use allowed; ship the licence text,
  // never sell the fonts on their own (compliance.md §3). Reviewed 2026-10-28.
  'OFL-1.1',
]);

// Reviewed exceptions: "package-name": "reason and date".
const REVIEWED_EXCEPTIONS = {};

// Fixed command string (no user input), run through the shell so pnpm resolves on Windows too.
const output = execSync('pnpm -r licenses list --prod --json', { encoding: 'utf8' });
const byLicense = JSON.parse(output);

// SPDX expressions such as "(MIT OR Apache-2.0)" are fine if every alternative is allowed;
// "A AND B" requires all parts to be allowed either way.
const isAllowed = (license) =>
  license
    .replace(/[()]/g, '')
    .split(/\s+(?:OR|AND)\s+/)
    .every((part) => ALLOWED.has(part.trim()));

const problems = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    count += 1;
    if (!isAllowed(license) && !(pkg.name in REVIEWED_EXCEPTIONS)) {
      problems.push(`  - ${pkg.name}@${pkg.versions.join(',')}: ${license}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Licence check failed. Not on the allow-list:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Licence check passed: ${count} production packages, all on the allow-list.`);
