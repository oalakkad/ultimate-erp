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

// Reviewed exceptions: "package-name": "reason and date". A key also covers the package's
// platform binaries ("name-<platform>"). Everything here is build-time tooling that `expo` lists
// as a dependency; none of it ends up in the mobile app bundle or on a server (compliance.md §3).
const REVIEWED_EXCEPTIONS = {
  // Python-2.0 (OSI-approved, permissive). Pulled in by js-yaml inside Expo's config loader.
  argparse: 'Expo build tooling; Python-2.0 is permissive. Reviewed 2026-11-01.',
  // CC-BY-4.0 data (browser support table) used by browserslist during the Metro build.
  'caniuse-lite':
    'Expo build tooling; data only, attribution kept in THIRD_PARTY_NOTICES. Reviewed 2026-11-01.',
  // MPL-2.0 (file-level copyleft): used unmodified as a CSS tool during the Metro build; not shipped.
  lightningcss:
    'Expo build tooling; unmodified, not distributed with the product. Reviewed 2026-11-01.',
};

// Fixed command string (no user input), run through the shell so pnpm resolves on Windows too.
const output = execSync('pnpm -r licenses list --prod --json', { encoding: 'utf8' });
const byLicense = JSON.parse(output);

// SPDX expressions: "(A OR B)" lets us choose, so one allowed alternative is enough (we take it,
// e.g. node-forge "BSD-3-Clause OR GPL-2.0" → BSD-3-Clause); "A AND B" needs every part allowed.
// Mixed expressions are judged strictly (every part).
const isAllowed = (license) => {
  const plain = license.replace(/[()]/g, '');
  const parts = plain.split(/\s+(?:OR|AND)\s+/).map((part) => part.trim());
  const onlyOr = /\sOR\s/.test(plain) && !/\sAND\s/.test(plain);
  return onlyOr
    ? parts.some((part) => ALLOWED.has(part))
    : parts.every((part) => ALLOWED.has(part));
};

const reviewed = (name) =>
  Object.keys(REVIEWED_EXCEPTIONS).some((key) => name === key || name.startsWith(`${key}-`));

const problems = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    count += 1;
    if (!isAllowed(license) && !reviewed(pkg.name)) {
      problems.push(`  - ${pkg.name}@${pkg.versions.join(',')}: ${license}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Licence check failed. Not on the allow-list:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Licence check passed: ${count} production packages, all on the allow-list.`);
