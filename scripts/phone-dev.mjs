// Makes the local dev stack reachable from a phone on the same Wi-Fi, for testing the mobile app
// (docs/operations.md §8). A phone cannot resolve `acme.localhost`, so companies get a second,
// phone-friendly address under nip.io: `acme.192-168-1-20.nip.io` always resolves to 192.168.1.20.
//
//   node scripts/phone-dev.mjs            use this machine's Wi-Fi/Ethernet address
//   node scripts/phone-dev.mjs --ip 192.168.1.20
//   node scripts/phone-dev.mjs --off      back to localhost
//
// Changes .env (PLATFORM_BASE_DOMAIN, WEB_PUBLIC_URL, CORS_ORIGINS) and adds a verified domain row
// for every existing company. Development only: refuses to run against anything but a local database.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

const args = process.argv.slice(2);
const off = args.includes('--off');
const ipArg = args[args.indexOf('--ip') + 1];

function lanAddress() {
  if (args.includes('--ip') && ipArg) return ipArg;
  const skip = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|Tailscale|ZeroTier/i;
  const candidates = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) candidates.push({ name, address: net.address });
    }
  }
  const preferred =
    candidates.find((c) => c.address.startsWith('192.168.')) ??
    candidates.find((c) => c.address.startsWith('10.')) ??
    candidates[0];
  if (!preferred) throw new Error('No Wi-Fi/Ethernet address found. Pass one with --ip.');
  return preferred.address;
}

const env = readFileSync('.env', 'utf8');
const get = (key) => env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? '';
const set = (text, key, value) =>
  new RegExp(`^${key}=.*$`, 'm').test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`)
    : `${text.trimEnd()}\n${key}=${value}\n`;

const dbHost = new URL(get('DATABASE_ADMIN_URL') || 'postgres://x@127.0.0.1/erp').hostname;
if (dbHost !== '127.0.0.1' && dbHost !== 'localhost') {
  throw new Error(`Refusing: DATABASE_ADMIN_URL points at ${dbHost}, not a local database.`);
}

const origins = get('CORS_ORIGINS')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o !== '' && !o.endsWith('.nip.io:5173'));

if (off) {
  let next = set(env, 'PLATFORM_BASE_DOMAIN', 'localhost');
  next = set(next, 'WEB_PUBLIC_URL', 'http://localhost:5173');
  next = set(next, 'CORS_ORIGINS', origins.join(','));
  writeFileSync('.env', next);
  console.log(
    'Back to localhost. Restart `pnpm dev`. (The nip.io domain rows stay; they are harmless.)',
  );
  process.exit(0);
}

const ip = lanAddress();
const base = `${ip.replace(/\./g, '-')}.nip.io`;
const web = `http://${base}:5173`;

let next = set(env, 'PLATFORM_BASE_DOMAIN', base);
next = set(next, 'WEB_PUBLIC_URL', web);
next = set(next, 'CORS_ORIGINS', [...origins, web].join(','));
writeFileSync('.env', next);

// Every existing company gets `<slug>.<base>` as a second verified address (psql inside the dev
// container, as the development superuser: tenant_domains has forced row security).
const sql = `
  INSERT INTO tenant_domains (tenant_id, hostname, kind, verified_at)
  SELECT id, slug || '.${base}', 'subdomain', now() FROM tenants WHERE status = 'active'
  ON CONFLICT (hostname) DO NOTHING;
  SELECT count(*) AS phone_addresses FROM tenant_domains WHERE hostname LIKE '%.${base}';`;
const pgUser = get('POSTGRES_USER') || 'erp_dev';
const pgDb = get('POSTGRES_DB') || 'erp';
const out = execFileSync(
  'docker',
  [
    'compose',
    '-f',
    'infra/compose/compose.dev.yaml',
    '--env-file',
    '.env',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    pgUser,
    '-d',
    pgDb,
    '-v',
    'ON_ERROR_STOP=1',
    '-tA',
    '-c',
    sql,
  ],
  { encoding: 'utf8' },
).trim();

console.log(`
Phone testing is set up for ${ip}.

  Companies are now also reachable at  <slug>.${base}:5173  (${out.split('\n').pop()} addresses).
  .env: PLATFORM_BASE_DOMAIN=${base}, WEB_PUBLIC_URL=${web}, CORS_ORIGINS += ${web}

Next:
  1. Restart the dev stack:        pnpm dev
     (Windows Firewall may ask once: allow node.exe on private networks.)
  2. Start the app for Expo Go:    pnpm --filter @ultimate-erp/mobile start
     with EXPO_PUBLIC_API_URL=${web} in the environment, so the server address is pre-filled.
     On the iPhone: install "Expo Go" from the App Store, then scan the QR in the terminal
     (or in Expo Go: "Enter URL manually" -> exp://${ip}:8081).
  3. In the app, if the server address is not pre-filled, tap "Server address" and enter ${web}
  4. Back to normal later:         node scripts/phone-dev.mjs --off

If names like acme.${base} do not resolve on the phone, the Wi-Fi router blocks DNS answers that
point at private addresses ("DNS rebinding protection"); turn that off or use a phone hotspot.
`);
