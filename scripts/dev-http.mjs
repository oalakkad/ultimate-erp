// DEVELOPMENT HELPER — talk to the local API as a named person, including company addresses
// like http://acme.localhost:3000 (Windows PowerShell cannot resolve *.localhost itself).
//
//   pnpm http <METHOD> <url> [key=value ...] [key:=json ...] [--as <person>]
//
// Examples:
//   pnpm http POST http://localhost:3000/api/v1/auth/sign-in email=omar@example.com "password=my long test password 2026"
//   pnpm http GET  http://omar-audit.localhost:3000/api/v1/access/me
//   pnpm http POST http://localhost:3000/api/v1/auth/two-factor/verify code=123456 trustDevice:=false --as bob
//
// key=value sends a string, key:=value sends raw JSON (numbers, true/false, ["arrays"]).
// Cookies are kept per person and per host in .dev-cookies/ (git-ignored), like separate browsers.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';

const args = process.argv.slice(2);
const asIndex = args.indexOf('--as');
const person = asIndex === -1 ? 'me' : args.splice(asIndex, 2)[1];
const [method, rawUrl, ...fields] = args;
if (!method || !rawUrl) {
  console.error('Usage: pnpm http <METHOD> <url> [key=value ...] [key:=json ...] [--as <person>]');
  process.exit(2);
}
const url = new URL(rawUrl);
if (
  url.protocol !== 'http:' ||
  !(url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))
) {
  console.error(
    'This helper only talks to http://localhost or http://<name>.localhost (development).',
  );
  process.exit(2);
}

const body = {};
for (const field of fields) {
  const raw = field.indexOf(':=');
  const eq = field.indexOf('=');
  if (raw > 0 && raw < eq + 1) body[field.slice(0, raw)] = JSON.parse(field.slice(raw + 2));
  else if (eq > 0) body[field.slice(0, eq)] = field.slice(eq + 1);
  else throw new Error(`Cannot read "${field}" — use key=value or key:=json`);
}
const payload = fields.length > 0 ? JSON.stringify(body) : undefined;

const jarFile = `.dev-cookies/${person.replace(/[^a-z0-9_-]/gi, '_')}.json`;
let jar = {};
try {
  jar = JSON.parse(readFileSync(jarFile, 'utf8'));
} catch {
  // first request for this person
}
const cookies = jar[url.host] ?? {};

const res = await new Promise((resolve, reject) => {
  const req = request(
    {
      host: '127.0.0.1', // *.localhost always means this computer
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        Host: url.host,
        'User-Agent': `dev-http/${person}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(Object.keys(cookies).length
          ? {
              Cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join('; '),
            }
          : {}),
      },
    },
    (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () => resolve({ response, text }));
    },
  );
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
}).catch((err) => {
  console.error(`Could not reach ${url.host}: ${err.message}. Is "pnpm dev" running?`);
  process.exit(1);
});

for (const setCookie of res.response.headers['set-cookie'] ?? []) {
  const [pair, ...attributes] = setCookie.split(';');
  const name = pair.slice(0, pair.indexOf('='));
  const value = pair.slice(pair.indexOf('=') + 1);
  const expired = attributes.some((a) => /max-age=0\b/i.test(a.trim())) || value === '';
  if (expired) delete cookies[name];
  else cookies[name] = value;
}
jar[url.host] = cookies;
mkdirSync('.dev-cookies', { recursive: true });
writeFileSync(jarFile, JSON.stringify(jar, null, 2));

console.log(`HTTP ${res.response.statusCode}  (as "${person}")`);
try {
  console.log(JSON.stringify(JSON.parse(res.text), null, 2));
} catch {
  if (res.text) console.log(res.text);
}
