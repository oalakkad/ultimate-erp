// `pnpm deploy:verify` — proves the PRODUCTION setup works end to end (docs/operations.md §5):
// builds both images, starts infra/compose/compose.prod.example.yaml with freshly generated
// secrets behind an HTTPS proxy (test-only overlay compose.verify.yaml), checks the security
// headers, runs the full browser journey (EN) against it, checks that client IPs survive the
// proxies, makes and verifies a backup with the image's own tools, then removes everything.
//   --skip-build   reuse ultimate-erp-api:latest / ultimate-erp-web:latest
//   --keep         leave the stack running afterwards (https://verify.test:8443)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT = 'uerp-verify';
const DOMAIN = 'verify.test';
const PORT = 8443;
const MAILPIT_PORT = 18025;
const BASE = `https://${DOMAIN}:${PORT}`;
const flags = new Set(process.argv.slice(2));
const started = Date.now();
const secret = (bytes) => randomBytes(bytes).toString('base64url');
const step = (text) =>
  console.log(`\n=== ${text} (${Math.round((Date.now() - started) / 1000)} s)`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`Failed: ${command} ${args.join(' ')}`);
  return result;
}
function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`Failed: ${command} ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

/** HTTPS request to the test proxy on this machine, accepting its throwaway certificate. */
function get(path, host = DOMAIN) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        servername: host,
        headers: { Host: `${host}:${PORT}` },
        rejectUnauthorized: false, // test-only local certificate
        timeout: 10_000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const failures = [];
function check(condition, text) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${text}`);
  if (!condition) failures.push(text);
}

async function until(what, test, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await test()) return;
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const dir = mkdtempSync(join(tmpdir(), 'uerp-verify-'));
const envFile = join(dir, 'verify.env');
const compose = [
  'compose',
  '-p',
  PROJECT,
  '-f',
  'infra/compose/compose.prod.example.yaml',
  '-f',
  'infra/compose/compose.verify.yaml',
  '--env-file',
  envFile,
];

try {
  if (!flags.has('--skip-build')) {
    step('Building the images');
    run('docker', [
      'build',
      '-f',
      'infra/docker/api.Dockerfile',
      '-t',
      'ultimate-erp-api:latest',
      '.',
    ]);
    run('docker', [
      'build',
      '-f',
      'infra/docker/web.Dockerfile',
      '-t',
      'ultimate-erp-web:latest',
      '.',
    ]);
  }

  step('Starting the production compose file with generated secrets');
  writeFileSync(
    envFile,
    [
      `POSTGRES_PASSWORD=${secret(24)}`,
      `MIGRATOR_PASSWORD=${secret(24)}`,
      `APP_PASSWORD=${secret(24)}`,
      `AUTH_SECRET=${secret(48)}`,
      `DATA_ENCRYPTION_KEY=${secret(48)}`,
      `BACKUP_ENCRYPTION_KEY=${secret(48)}`,
      `APP_PUBLIC_URL=${BASE}`,
      `WEB_PUBLIC_URL=${BASE}`,
      `PLATFORM_BASE_DOMAIN=${DOMAIN}`,
      'SMTP_HOST=mailpit',
      'SMTP_PORT=1025',
      'SMTP_SECURE=false',
      'SMTP_USER=',
      'SMTP_PASSWORD=',
      `SMTP_FROM=Ultimate ERP <no-reply@${DOMAIN}>`,
      'S3_ACCESS_KEY=verify-access-key',
      `S3_SECRET_KEY=${secret(24)}`,
      `S3_PUBLIC_ENDPOINT=https://files.${DOMAIN}:${PORT}`,
      'TRUST_PROXY_HOPS=2',
      'SENTRY_DSN=',
      `VERIFY_HTTPS_PORT=${PORT}`,
      `VERIFY_MAILPIT_PORT=${MAILPIT_PORT}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  run('docker', [...compose, 'down', '-v', '--remove-orphans'], { stdio: 'ignore' });
  run('docker', [...compose, 'up', '-d']);

  step('Waiting for the API (through HTTPS -> web -> API) and the virus scanner');
  await until('the API', async () => (await get('/api/v1/health')).status === 200, 300_000);
  await until(
    'ClamAV',
    () => capture('docker', [...compose, 'ps', '--format', '{{.Health}}', 'clamav']) === 'healthy',
    600_000,
  );

  step('Security headers');
  const page = await get('/');
  const csp = String(page.headers['content-security-policy'] ?? '');
  check(page.status === 200, 'the app loads over HTTPS');
  check(
    csp.includes("frame-ancestors 'none'") && csp.includes("default-src 'self'"),
    'app: Content-Security-Policy',
  );
  check(
    /max-age=\d{7,}; includeSubDomains/.test(String(page.headers['strict-transport-security'])),
    'app: HSTS incl. subdomains',
  );
  check(page.headers['x-content-type-options'] === 'nosniff', 'app: X-Content-Type-Options');
  check(page.headers['x-frame-options'] === 'DENY', 'app: X-Frame-Options');
  check(Boolean(page.headers['referrer-policy']), 'app: Referrer-Policy');
  check(Boolean(page.headers['permissions-policy']), 'app: Permissions-Policy');
  check(!/nginx\/\d/.test(String(page.headers.server ?? '')), 'app: no server version disclosed');
  const asset = page.body.match(/\/assets\/[^"']+\.js/)?.[0];
  const assetRes = asset ? await get(asset) : { status: 0, headers: {} };
  check(
    assetRes.status === 200 && String(assetRes.headers['cache-control']).includes('immutable'),
    'assets: cached as immutable',
  );
  check(assetRes.headers['x-content-type-options'] === 'nosniff', 'assets: X-Content-Type-Options');
  const api = await get('/api/v1/health');
  check(
    String(api.headers['content-security-policy']).includes("default-src 'none'"),
    "api: CSP default-src 'none'",
  );
  check(Boolean(api.headers['strict-transport-security']), 'api: HSTS');
  check(api.headers['x-powered-by'] === undefined, 'api: no X-Powered-By');
  const notices = await get('/third-party-notices.txt');
  check(
    notices.status === 200 && notices.body.startsWith('THIRD-PARTY SOFTWARE NOTICES'),
    'third-party notices are served',
  );
  const unknown = await get('/api/v1/tenant', `nobody.${DOMAIN}`);
  check(unknown.status === 404, 'an unknown company address answers 404');

  step('Browser journey (EN) against the production containers');
  const journey = spawnSync(
    'pnpm',
    [
      '--filter',
      '@ultimate-erp/web',
      'exec',
      'playwright',
      'test',
      '--project=deployed',
      '--grep',
      ' en$',
    ],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        E2E_WEB_URL: BASE,
        E2E_MAILPIT_URL: `http://127.0.0.1:${MAILPIT_PORT}/api/v1`,
      },
    },
  );
  check(journey.status === 0, 'the full first-day journey passes on the production setup');

  step('Client IPs through two proxies (TRUST_PROXY_HOPS=2)');
  const proxyIps = ['proxy', 'web'].map((service) =>
    capture('docker', [
      'inspect',
      '-f',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
      `${PROJECT}-${service}-1`,
    ]),
  );
  const auditIps = capture('docker', [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'erp_admin',
    '-d',
    'erp',
    '-At',
    '-c',
    'select distinct host(ip_address) from audit_events where ip_address is not null',
  ])
    .split('\n')
    .filter(Boolean);
  console.log(`audit IPs: ${auditIps.join(', ') || '(none)'}; proxy IPs: ${proxyIps.join(', ')}`);
  check(auditIps.length > 0, 'the audit log records client IPs');
  check(!auditIps.some((ip) => proxyIps.includes(ip)), 'no proxy address is mistaken for a client');

  step('Backup and verify with the server image');
  run('docker', [...compose, '--profile', 'ops', 'run', '--rm', 'backup']);
  const backupName = capture('docker', [
    ...compose,
    '--profile',
    'ops',
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    'verify',
    '-c',
    'ls /backups | tail -n 1',
  ]);
  run('docker', [
    ...compose,
    '--profile',
    'ops',
    'run',
    '--rm',
    'verify',
    `/backups/${backupName}`,
  ]);
  check(
    /^uerp-\d{8}T\d{6}Z$/.test(backupName),
    'a nightly backup runs and verifies inside the image',
  );
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  console.error(err);
  spawnSync(
    'docker',
    [...compose, 'logs', '--tail', '80', 'api', 'worker', 'migrate', 'bootstrap', 'proxy'],
    { stdio: 'inherit' },
  );
} finally {
  if (flags.has('--keep')) {
    console.log(
      `\nLeft running: ${BASE} (env file ${envFile}). Remove with:\n  docker ${compose.join(' ')} down -v`,
    );
  } else {
    spawnSync('docker', [...compose, '--profile', 'ops', 'down', '-v', '--remove-orphans'], {
      stdio: 'ignore',
    });
    rmSync(dir, { recursive: true, force: true });
  }
}

const minutes = ((Date.now() - started) / 60_000).toFixed(1);
if (failures.length > 0) {
  console.error(
    `\nDeployment verification FAILED after ${minutes} min:\n  - ${failures.join('\n  - ')}`,
  );
  process.exit(1);
}
console.log(`\nDeployment verification passed in ${minutes} min.`);
