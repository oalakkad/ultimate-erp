// `pnpm demo:seed` — DEVELOPMENT FIXTURES ONLY (never shipped: lives under test/, not built).
// Fills a fictional demo company through the running dev API, exactly as people would: real
// sign-ups confirmed from the dev Mailpit inbox, invitations, two-factor where a role needs it,
// and every record created through the module endpoints (so every business rule applies).
// Run `pnpm dev` first. Usage: pnpm demo:seed [--slug <name>]
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { isSensitive, type Role } from '@ultimate-erp/contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const API_PORT = Number(process.env.API_PORT ?? 3000);
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? 8025}/api/v1`;
// No password in source: a fresh random one per run (or DEMO_PASSWORD), written only to the
// git-ignored credentials file at the end.
const PASSWORD = process.env.DEMO_PASSWORD ?? `Demo-${randomBytes(9).toString('base64url')}`;
const WEB = 'http://localhost:5173';

const slugArg = process.argv.indexOf('--slug');
const SLUG = slugArg > 0 ? (process.argv[slugArg + 1] ?? '') : 'alnoor';
const HOST = `${SLUG}.localhost`;

// ---------------------------------------------------------------- small helpers

type Json = Record<string, unknown>;
/** The fields this seed reads from API answers (everything else is passed through untouched). */
interface Body {
  id: string;
  status?: string;
  items?: unknown;
  recipients?: number;
  totpUri?: string;
  backupCodes?: string[];
  [key: string]: unknown;
}
interface Res {
  status: number;
  body: Body;
}

const log = (line: string) => process.stdout.write(`${line}\n`);
const notes: string[] = [];
const counts: Record<string, number> = {};
const count = (key: string, n = 1) => (counts[key] = (counts[key] ?? 0) + n);

function fail(message: string): never {
  process.stderr.write(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Kuwait's calendar date, `offset` days from today. */
function day(offset = 0): string {
  const kuwait = new Date(Date.now() + 3 * 3_600_000);
  kuwait.setUTCDate(kuwait.getUTCDate() + offset);
  return kuwait.toISOString().slice(0, 10);
}
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** A Kuwait-time moment on `iso` (UTC+3) as an ISO date-time. */
const kuwaitTime = (iso: string, hhmm: string) => new Date(`${iso}T${hhmm}:00+03:00`).toISOString();
const isWorkday = (iso: string) => weekday(iso) <= 4; // Sunday–Thursday

/** Optional steps: a failure is reported and the seed carries on. */
async function soft(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notes.push(`${name}: ${message}`);
    log(`  ! skipped — ${name}: ${message.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------- a browser per person

let nextAddress = 30;

/**
 * One person's browser: a cookie jar (all cookies sent to every host, like the test agent) and
 * its own loopback source address, so per-address limits see separate machines.
 */
class Browser {
  readonly email: string;
  readonly address: string;
  private readonly jar = new Map<string, string>();

  constructor(email: string) {
    this.email = email;
    this.address = `127.0.0.${nextAddress++}`;
  }

  async send(
    method: string,
    path: string,
    body?: Json | { raw: Buffer; type: string },
    host = HOST,
  ): Promise<Res> {
    const raw =
      body && 'raw' in body
        ? (body.raw as Buffer)
        : body
          ? Buffer.from(JSON.stringify(body))
          : undefined;
    const type =
      body && 'raw' in body ? (body.type as string) : body ? 'application/json' : undefined;
    const headers: Record<string, string> = { Host: host, 'User-Agent': 'DemoSeed/1' };
    if (type) headers['Content-Type'] = type;
    if (raw) headers['Content-Length'] = String(raw.length);
    if (this.jar.size) {
      headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    return new Promise<Res>((done, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: API_PORT,
          path: `/api/v1${path}`,
          method,
          headers,
          localAddress: this.address,
        },
        (res) => {
          for (const cookie of res.headers['set-cookie'] ?? []) {
            const [pair = '', ...attrs] = cookie.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            const gone = value === '' || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a.trim()));
            if (gone) this.jar.delete(name);
            else this.jar.set(name, value);
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed = text as unknown as Body;
            try {
              parsed = (text ? JSON.parse(text) : null) as Body;
            } catch {
              /* not JSON */
            }
            done({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on('error', reject);
      if (raw) req.write(raw);
      req.end();
    });
  }

  /** Sends and insists on a 2xx answer; returns the body. */
  async ok(method: string, path: string, body?: Json, host = HOST): Promise<Body> {
    const res = await this.send(method, path, body, host);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `${method} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`,
      );
    }
    return res.body;
  }
  get = (path: string, host = HOST) => this.ok('GET', path, undefined, host);
  post = (path: string, body: Json = {}, host = HOST) => this.ok('POST', path, body, host);
  put = (path: string, body: Json, host = HOST) => this.ok('PUT', path, body, host);
  patch = (path: string, body: Json, host = HOST) => this.ok('PATCH', path, body, host);

  /** Uploads a small PDF and waits until the virus scan has marked it clean. */
  async upload(name: string): Promise<string> {
    const boundary = `----demo${Date.now().toString(16)}`;
    const raw = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
          'Content-Type: application/pdf\r\n\r\n',
      ),
      pdf(name),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await this.send('POST', '/files', {
      raw,
      type: `multipart/form-data; boundary=${boundary}`,
    });
    if (res.status !== 201) throw new Error(`upload → ${res.status} ${JSON.stringify(res.body)}`);
    const id = res.body.id;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const file = await this.get(`/files/${id}`);
      if (file.status === 'clean') {
        count('files');
        return id;
      }
      if (file.status !== 'pending') throw new Error(`file ${name} is ${file.status}`);
      await sleep(1000);
    }
    throw new Error(`file ${name} was not scanned within 2 minutes (is ClamAV running?)`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pdf(title: string): Buffer {
  const text = title.replace(/[()\\]/g, '');
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R' +
      '/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
      `4 0 obj<</Length ${text.length + 40}>>stream\nBT /F1 14 Tf 30 100 Td (${text}) Tj ET\nendstream endobj\n` +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
  );
}

// ---------------------------------------------------------------- Mailpit and two-factor

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
}

async function waitForEmail(to: string, subject: string, since: number): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: MailSummary[] };
    const found = messages.find(
      (m) => m.Subject.includes(subject) && Date.parse(m.Created) >= since - 2000,
    );
    if (found) {
      const full = (await (await fetch(`${MAILPIT}/message/${found.ID}`)).json()) as {
        Text: string;
      };
      const url = full.Text.match(/https?:\/\/\S+/)?.[0];
      const token = url ? new URL(url).searchParams.get('token') : null;
      if (!token) throw new Error(`no link in "${found.Subject}" to ${to}`);
      return token;
    }
    await sleep(300);
  }
  throw new Error(`no "${subject}" email to ${to} within 30 s (is the worker running?)`);
}

async function totp(uri: string, offset = 0): Promise<string> {
  const secret = new URL(uri).searchParams.get('secret');
  if (!secret) throw new Error('totp URI has no secret');
  const step = Math.floor(Date.now() / 30_000) + offset;
  return createOTP(base32.decode(secret)).hotp(step);
}

// ---------------------------------------------------------------- the cast

interface Spec {
  key: string;
  name: string;
  nameAr: string;
  role: Role;
  titleEn: string;
  titleAr: string;
  dept: 'audit' | 'risk' | 'corporate';
  joinDate: string;
  basic: string;
  housing: string;
}

const CAST: Spec[] = [
  {
    key: 'fahad',
    name: 'Fahad Al-Mutairi',
    nameAr: 'فهد المطيري',
    role: 'owner',
    titleEn: 'Managing Partner',
    titleAr: 'الشريك المدير',
    dept: 'corporate',
    joinDate: '2019-02-03',
    basic: '4200.000',
    housing: '600.000',
  },
  {
    key: 'noura',
    name: 'Noura Al-Rashed',
    nameAr: 'نورة الراشد',
    role: 'ceo',
    titleEn: 'Chief Executive Officer',
    titleAr: 'الرئيسة التنفيذية',
    dept: 'corporate',
    joinDate: '2020-01-12',
    basic: '3800.000',
    housing: '550.000',
  },
  {
    key: 'yousef',
    name: 'Yousef Al-Kandari',
    nameAr: 'يوسف الكندري',
    role: 'manager',
    titleEn: 'Audit Manager',
    titleAr: 'مدير التدقيق',
    dept: 'audit',
    joinDate: '2021-03-07',
    basic: '2400.000',
    housing: '350.000',
  },
  {
    key: 'priya',
    name: 'Priya Nair',
    nameAr: 'بريا ناير',
    role: 'manager',
    titleEn: 'Risk Advisory Manager',
    titleAr: 'مديرة استشارات المخاطر',
    dept: 'risk',
    joinDate: '2022-05-15',
    basic: '2300.000',
    housing: '350.000',
  },
  {
    key: 'maryam',
    name: 'Maryam Al-Enezi',
    nameAr: 'مريم العنزي',
    role: 'hr_payroll',
    titleEn: 'HR & Payroll Lead',
    titleAr: 'مسؤولة الموارد البشرية والرواتب',
    dept: 'corporate',
    joinDate: '2021-09-01',
    basic: '1700.000',
    housing: '250.000',
  },
  {
    key: 'ahmed',
    name: 'Ahmed Hassan',
    nameAr: 'أحمد حسن',
    role: 'finance',
    titleEn: 'Finance Officer',
    titleAr: 'مسؤول المالية',
    dept: 'corporate',
    joinDate: '2022-10-02',
    basic: '1500.000',
    housing: '200.000',
  },
  {
    key: 'sara',
    name: 'Sara Al-Hajri',
    nameAr: 'سارة الهاجري',
    role: 'team_leader',
    titleEn: 'Senior Auditor',
    titleAr: 'مدققة أولى',
    dept: 'audit',
    joinDate: '2022-01-09',
    basic: '1600.000',
    housing: '250.000',
  },
  {
    key: 'omar',
    name: 'Omar Al-Shammari',
    nameAr: 'عمر الشمري',
    role: 'employee',
    titleEn: 'Auditor',
    titleAr: 'مدقق',
    dept: 'audit',
    joinDate: '2023-08-20',
    basic: '1100.000',
    housing: '150.000',
  },
  {
    key: 'rahul',
    name: 'Rahul Menon',
    nameAr: 'راهول مينون',
    role: 'employee',
    titleEn: 'Risk Analyst',
    titleAr: 'محلل مخاطر',
    dept: 'risk',
    joinDate: '2023-11-05',
    basic: '1050.000',
    housing: '150.000',
  },
  {
    key: 'dana',
    name: 'Dana Al-Awadhi',
    nameAr: 'دانة العوضي',
    role: 'employee',
    titleEn: 'Auditor',
    titleAr: 'مدققة',
    dept: 'audit',
    joinDate: '2024-02-11',
    basic: '1000.000',
    housing: '150.000',
  },
  {
    key: 'mohammed',
    name: 'Mohammed Saleh',
    nameAr: 'محمد صالح',
    role: 'employee',
    titleEn: 'IT Audit Specialist',
    titleAr: 'أخصائي تدقيق تقنية المعلومات',
    dept: 'risk',
    joinDate: '2024-06-02',
    basic: '1150.000',
    housing: '150.000',
  },
  {
    key: 'fatima',
    name: 'Fatima Al-Ali',
    nameAr: 'فاطمة العلي',
    role: 'employee',
    titleEn: 'Junior Auditor',
    titleAr: 'مدققة مبتدئة',
    dept: 'audit',
    joinDate: '2025-09-14',
    basic: '850.000',
    housing: '100.000',
  },
];

interface Member extends Spec {
  email: string;
  browser: Browser;
  membershipId: string;
  twoFactor?: { totpUri: string; backupCodes: string[] };
}

// ---------------------------------------------------------------- the seed

async function preflight(): Promise<void> {
  if (process.env.NODE_ENV !== 'development' || process.env.APP_PROFILE !== 'dev') {
    fail('Demo data is for local development only (NODE_ENV=development, APP_PROFILE=dev).');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(SLUG))
    fail(`"${SLUG}" is not a valid company address.`);
  const probe = new Browser('probe');
  try {
    await probe.get('/health', 'localhost');
  } catch {
    fail(`The API is not answering on http://127.0.0.1:${API_PORT}. Start it with \`pnpm dev\`.`);
  }
  try {
    await fetch(`${MAILPIT}/messages?limit=1`);
  } catch {
    fail(`The dev mail inbox (Mailpit) is not answering on ${MAILPIT}. Run \`pnpm services:up\`.`);
  }
  const tenant = await probe.send('GET', '/tenant', undefined, HOST);
  if (tenant.status !== 404) {
    fail(
      `A company with the address "${SLUG}" already exists (companies are never deleted).\n` +
        `  Seed another one: pnpm demo:seed --slug ${SLUG}2`,
    );
  }
}

async function account(spec: Spec): Promise<Member> {
  const email = `${spec.key}.${SLUG}@example.com`;
  const browser = new Browser(email);
  const signIn = () =>
    browser.send('POST', '/auth/sign-in', { email, password: PASSWORD }, 'localhost');
  let res = await signIn();
  if (res.status !== 200) {
    const since = Date.now();
    await browser.post(
      '/auth/sign-up',
      { email, password: PASSWORD, name: spec.name, locale: 'en' },
      'localhost',
    );
    const token = await waitForEmail(email, 'Confirm your email', since);
    await browser.get(`/auth/verify-email?token=${encodeURIComponent(token)}`, 'localhost');
    res = await signIn();
  }
  if (res.status !== 200 || res.body.status !== 'signed_in') {
    throw new Error(`sign-in for ${email} → ${res.status} ${JSON.stringify(res.body)}`);
  }
  count('accounts');
  return { ...spec, email, browser, membershipId: '' };
}

async function enableTwoFactor(m: Member): Promise<void> {
  const setup = await m.browser.post(
    '/auth/two-factor/enable',
    { password: PASSWORD },
    'localhost',
  );
  await m.browser.post(
    '/auth/two-factor/confirm',
    { code: await totp(setup.totpUri as string) },
    'localhost',
  );
  m.twoFactor = { totpUri: setup.totpUri ?? '', backupCodes: setup.backupCodes ?? [] };
}

async function main(): Promise<void> {
  await preflight();
  log(`Seeding demo company "${SLUG}" through ${HOST} …`);

  // People: accounts, company, invitations, two-factor ---------------------------------
  log('• accounts');
  const people: Member[] = [];
  for (const spec of CAST) people.push(await account(spec));
  const by = (key: string) => {
    const found = people.find((p) => p.key === key);
    if (!found) throw new Error(`no ${key}`);
    return found;
  };
  const [owner, ceo, yousef, priya, maryam, ahmed, sara] = [
    'fahad',
    'noura',
    'yousef',
    'priya',
    'maryam',
    'ahmed',
    'sara',
  ].map(by) as [Member, Member, Member, Member, Member, Member, Member];
  const staff = people.filter((p) => p.role === 'employee');

  log('• company');
  await owner.browser.post(
    '/companies',
    {
      slug: SLUG,
      nameEn:
        SLUG === 'alnoor'
          ? 'Al Noor Audit & Advisory (demo)'
          : `Al Noor Audit & Advisory (${SLUG})`,
      nameAr: 'النور للتدقيق والاستشارات (تجريبي)',
      defaultLocale: 'en',
    },
    'localhost',
  );
  await enableTwoFactor(owner);

  log('• invitations');
  for (const p of people) {
    if (p === owner) continue;
    const since = Date.now();
    await owner.browser.post('/invitations', { email: p.email, role: p.role });
    const token = await waitForEmail(p.email, 'invited', since);
    await p.browser.post('/invitations/accept', { token });
    if (isSensitive([p.role])) await enableTwoFactor(p);
    count('invitations');
  }
  const { members } = (await owner.browser.get('/members')) as unknown as {
    members: { email: string; membershipId: string }[];
  };
  for (const p of people) {
    p.membershipId = members.find((m) => m.email === p.email)?.membershipId ?? '';
    if (!p.membershipId) throw new Error(`${p.email} did not become a member`);
  }

  // People records, departments, team, holidays ----------------------------------------
  log('• departments, people records, team');
  const departments: Record<Spec['dept'], string> = { audit: '', risk: '', corporate: '' };
  for (const [key, en, ar] of [
    ['audit', 'Audit & Assurance', 'التدقيق والتأكيد'],
    ['risk', 'Risk & Advisory', 'المخاطر والاستشارات'],
    ['corporate', 'Corporate Services', 'الخدمات المؤسسية'],
  ] as const) {
    departments[key] = (await maryam.browser.post('/departments', { nameEn: en, nameAr: ar })).id;
    count('departments');
  }
  const managerOf: Record<string, Member | null> = {
    fahad: null,
    noura: owner,
    yousef: ceo,
    priya: ceo,
    maryam: ceo,
    ahmed: ceo,
    sara: yousef,
    omar: sara,
    dana: sara,
    fatima: sara,
    rahul: priya,
    mohammed: priya,
  };
  for (const p of people) {
    await maryam.browser.post('/people', {
      membershipId: p.membershipId,
      jobTitleEn: p.titleEn,
      jobTitleAr: p.titleAr,
      departmentId: departments[p.dept],
      managerMembershipId: managerOf[p.key]?.membershipId ?? null,
      employmentType: p.key === 'fatima' ? 'intern' : 'full_time',
      joinDate: p.joinDate,
      weeklyHours: '40',
      workDays: [0, 1, 2, 3, 4],
    });
    count('people records');
  }
  await soft('team', async () => {
    const teams = await maryam.browser.post('/teams', {
      nameEn: 'Audit Team A',
      nameAr: 'فريق التدقيق أ',
      departmentId: departments.audit,
      leadMembershipId: sara.membershipId,
    });
    const team = (teams.items as { id: string; name: { en: string } }[]).find(
      (t) => t.name.en === 'Audit Team A',
    );
    if (!team) throw new Error('team not in the list');
    await maryam.browser.put(`/teams/${team.id}/members`, {
      memberIds: [sara, by('omar'), by('dana'), by('fatima')].map((p) => p.membershipId),
    });
    count('teams');
  });
  await soft('emergency contacts', async () => {
    for (const p of staff) {
      await maryam.browser.post(`/people/${p.membershipId}/emergency-contacts`, {
        name: `${p.name.split(' ')[0]}'s family`,
        relationship: 'Spouse',
        phone: '+965 9' + String(1000000 + p.joinDate.length * 123457).slice(0, 7),
      });
    }
  });

  const year = Number(day().slice(0, 4));
  const HOLIDAYS = [
    [`${year}-01-01`, "New Year's Day", 'رأس السنة الميلادية'],
    [`${year}-02-25`, 'National Day', 'العيد الوطني'],
    [`${year}-02-26`, 'Liberation Day', 'عيد التحرير'],
    [`${year}-03-20`, 'Eid al-Fitr', 'عيد الفطر'],
    [`${year}-03-21`, 'Eid al-Fitr (day 2)', 'عيد الفطر (اليوم الثاني)'],
    [`${year}-03-22`, 'Eid al-Fitr (day 3)', 'عيد الفطر (اليوم الثالث)'],
    [`${year}-05-26`, 'Arafat Day', 'يوم عرفة'],
    [`${year}-05-27`, 'Eid al-Adha', 'عيد الأضحى'],
    [`${year}-05-28`, 'Eid al-Adha (day 2)', 'عيد الأضحى (اليوم الثاني)'],
    [`${year}-06-16`, 'Islamic New Year', 'رأس السنة الهجرية'],
    [`${year}-08-25`, "Prophet's Birthday", 'المولد النبوي'],
  ];
  await soft('public holidays', async () => {
    await maryam.browser.put('/leave/holidays', {
      year,
      holidays: HOLIDAYS.map(([date, nameEn, nameAr]) => ({ date, nameEn, nameAr })),
    });
    count('public holidays', HOLIDAYS.length);
  });

  // Clients and contracts -----------------------------------------------------------
  log('• clients');
  const CLIENTS = [
    ['Gulf Horizon Trading Co.', 'شركة أفق الخليج التجارية', 'Trading', 'GH-48213', 'yousef'],
    ['Al Bayan Real Estate', 'البيان العقارية', 'Real estate', 'BR-77310', 'yousef'],
    [
      'Wataniya Logistics Group',
      'مجموعة الوطنية للخدمات اللوجستية',
      'Logistics',
      'WL-20934',
      'priya',
    ],
    ['Sadeem Investment Company', 'شركة سديم للاستثمار', 'Investment', 'SI-55102', 'priya'],
    ['Marina Healthcare Clinics', 'عيادات المارينا الطبية', 'Healthcare', 'MH-30871', 'yousef'],
    ['Kuwait Bay Foods', 'أغذية جون الكويت', 'Food & beverage', 'KB-61245', 'yousef'],
    ['Najd Engineering Consultants', 'نجد للاستشارات الهندسية', 'Engineering', 'NE-14598', 'priya'],
    [
      'Ministry of Public Works (pilot)',
      'وزارة الأشغال العامة (تجريبي)',
      'Government',
      '',
      'priya',
    ],
  ] as const;
  const clients: { id: string; name: string; manager: Member }[] = [];
  for (const [i, [en, ar, industry, cr, mgr]] of CLIENTS.entries()) {
    const manager = by(mgr);
    const c = await manager.browser.post('/clients', {
      type: cr ? 'company' : 'government',
      legalNameEn: en,
      legalNameAr: ar,
      commercialRegistration: cr,
      industry,
      email: `finance@${en
        .toLowerCase()
        .replace(/[^a-z]+/g, '')
        .slice(0, 14)}.example.com`,
      phone: `+965 2${String(2200000 + i * 13579).slice(0, 7)}`,
      addressLine: `Block ${3 + i}, Street ${10 + i * 3}`,
      city: ['Kuwait City', 'Salmiya', 'Hawalli', 'Farwaniya'][i % 4],
      country: 'KW',
      status: i === 7 ? 'prospect' : 'active',
      accountManagerMembershipId: manager.membershipId,
    });
    clients.push({ id: c.id, name: en, manager });
    count('clients');
    await soft(`contact for ${en}`, async () => {
      await manager.browser.post(`/clients/${c.id}/contacts`, {
        name: ['Abdullah Al-Fadhli', 'Hessa Al-Mulla', 'Bader Al-Qattan', 'Lulwa Al-Saleh'][i % 4],
        position: 'Chief Financial Officer',
        isPrimary: true,
        isAuthorizedRepresentative: true,
      });
      await manager.browser.post(`/clients/${c.id}/interactions`, {
        kind: i % 2 ? 'meeting' : 'call',
        occurredAt: kuwaitTime(day(-10 - i), '10:30'),
        summary:
          i % 2
            ? 'Planning meeting for this year’s engagement.'
            : 'Agreed the fee and timeline by phone.',
      });
      count('contacts');
    });
  }

  log('• contracts');
  const contracts: (string | null)[] = clients.map(() => null);
  for (const [i, c] of clients.entries()) {
    if (i >= 7) break;
    const m = c.manager;
    await soft(`contract for ${c.name}`, async () => {
      const value =
        ['18000.000', '9500.000', '24000.000', '12500.000', '7200.000', '6000.000', '15000.000'][
          i
        ] ?? '5000.000';
      const doc = await m.browser.post('/contracts', {
        kind: i % 2 ? 'contract' : 'engagement_letter',
        clientId: c.id,
        titleEn: i % 2 ? 'Risk advisory services' : `Statutory audit FY${year - 1}`,
        titleAr: i % 2 ? 'خدمات استشارات المخاطر' : `التدقيق القانوني للسنة المالية ${year - 1}`,
        startDate: addDays(day(), -75 + i * 3),
        endDate: addDays(day(), 290),
        valueAmount: value,
        currency: 'KWD',
        paymentTerms:
          '40% on signing, 60% on delivery of the final report. Payment within 30 days.',
        renewalNoticeDays: 60,
      });
      count('contracts');
      if (i === 6) return; // left as a draft
      await m.browser.post(`/contracts/${doc.id}/versions`, {
        bodyEn:
          `This letter confirms the terms on which ${c.name} engages Al Noor Audit & Advisory.\n\n` +
          'Scope: as agreed in the planning meeting. Fees as stated above.',
        bodyAr: `تؤكد هذه الرسالة الشروط التي تتعاقد بموجبها ${CLIENTS[i]?.[1] ?? ''} مع النور للتدقيق والاستشارات.`,
      });
      await m.browser.post(`/contracts/${doc.id}/submit`);
      if (i === 5) return; // waiting for approval
      await owner.browser.post(`/contracts/${doc.id}/approve`);
      await m.browser.post(`/contracts/${doc.id}/send`);
      const fileId = await m.browser.upload(`Signed ${c.name}.pdf`);
      await m.browser.post(`/contracts/${doc.id}/sign`, {
        fileId,
        signedOn: addDays(day(), -70 + i * 3),
      });
      await m.browser.post(`/contracts/${doc.id}/activate`);
      contracts[i] = doc.id;
      count('contracts active');
    });
  }

  // Projects and tasks --------------------------------------------------------------
  log('• projects and tasks');
  const audit = [sara, by('omar'), by('dana'), by('fatima')];
  const risk = [by('rahul'), by('mohammed')];
  const PROJECTS = [
    {
      c: 0,
      en: `Gulf Horizon — statutory audit FY${year - 1}`,
      ar: `أفق الخليج — التدقيق القانوني ${year - 1}`,
      method: 'fixed_price',
      hours: '520',
      amount: '18000.000',
      team: audit,
      tasks: [
        'Planning and risk assessment',
        'Inventory count observation',
        'Revenue testing',
        'Draft financial statements review',
      ],
    },
    {
      c: 1,
      en: 'Al Bayan — internal controls review',
      ar: 'البيان — مراجعة الضوابط الداخلية',
      method: 'time_and_materials',
      hours: '300',
      amount: '9500.000',
      team: [sara, by('dana')],
      tasks: ['Process walkthroughs', 'Control testing', 'Management letter'],
    },
    {
      c: 2,
      en: 'Wataniya — enterprise risk framework',
      ar: 'الوطنية — إطار إدارة المخاطر',
      method: 'fixed_price',
      hours: '640',
      amount: '24000.000',
      team: risk,
      tasks: ['Risk workshops', 'Risk register build', 'Board reporting pack'],
    },
    {
      c: 3,
      en: 'Sadeem — AML compliance review',
      ar: 'سديم — مراجعة الامتثال لمكافحة غسل الأموال',
      method: 'time_and_materials',
      hours: '280',
      amount: '12500.000',
      team: [by('rahul'), by('mohammed')],
      tasks: ['KYC file sampling', 'Transaction monitoring review'],
    },
    {
      c: 4,
      en: 'Marina Clinics — revenue cycle audit',
      ar: 'عيادات المارينا — تدقيق دورة الإيرادات',
      method: 'fixed_price',
      hours: '200',
      amount: '7200.000',
      team: [by('omar'), by('fatima')],
      tasks: ['Billing data analytics', 'Insurance claims testing'],
    },
    {
      c: 5,
      en: 'Kuwait Bay Foods — monthly bookkeeping',
      ar: 'أغذية جون الكويت — مسك الدفاتر الشهري',
      method: 'retainer',
      hours: '160',
      amount: '6000.000',
      team: [by('dana'), by('fatima')],
      tasks: ['October close'],
    },
    {
      c: 6,
      en: 'Najd — IT general controls',
      ar: 'نجد — الضوابط العامة لتقنية المعلومات',
      method: 'time_and_materials',
      hours: '180',
      amount: '15000.000',
      team: [by('mohammed')],
      tasks: ['Access management review', 'Change management testing'],
    },
    {
      c: 7,
      en: 'Public Works — proposal preparation',
      ar: 'الأشغال العامة — إعداد العرض',
      method: 'non_billable',
      hours: '40',
      amount: null,
      team: [by('rahul')],
      tasks: ['Proposal draft'],
    },
  ] as const;
  interface Project {
    id: string;
    name: string;
    manager: Member;
    tasks: { id: string; title: string; people: Member[] }[];
    clientId: string;
    method: string;
  }
  const projects: Project[] = [];
  for (const [i, spec] of PROJECTS.entries()) {
    const client = clients[spec.c];
    if (!client) continue;
    const manager = client.manager;
    const team = [...spec.team] as Member[];
    const p = await owner.browser.post('/projects', {
      clientId: client.id,
      nameEn: spec.en,
      nameAr: spec.ar,
      description: 'Demo engagement (fictional).',
      contractId: contracts[spec.c] ?? null,
      managerMembershipId: manager.membershipId,
      startDate: addDays(day(), -60 + i * 2),
      endDate: addDays(day(), 45 + i * 10),
      billingMethod: spec.method,
      budgetHours: spec.hours,
      budgetAmount: spec.amount,
      currency: 'KWD',
      memberIds: team.map((t) => t.membershipId),
    });
    count('projects');
    if (i !== 7) await owner.browser.post(`/projects/${p.id}/status`, { status: 'active' });
    const project: Project = {
      id: p.id,
      name: spec.en,
      manager,
      tasks: [],
      clientId: client.id,
      method: spec.method,
    };
    const perTask = Math.floor(
      Number(spec.hours) / spec.tasks.length / Math.max(team.length, 1) / 1.25,
    );
    for (const [t, title] of spec.tasks.entries()) {
      const people = team.filter((_, k) => (k + t) % 2 === 0 || team.length <= 2);
      const task = await manager.browser.post('/tasks', {
        projectId: p.id,
        title,
        description: null,
        priority: (['normal', 'high', 'normal', 'urgent'] as const)[t % 4],
        startDate: addDays(day(), -45 + t * 7),
        dueDate: addDays(day(), t === 0 ? -3 : 7 + t * 9),
        estimatedHours: String(perTask * people.length),
        status: 'ready',
        allocations: people.map((m) => ({ membershipId: m.membershipId, hours: String(perTask) })),
      });
      project.tasks.push({ id: task.id, title, people });
      count('tasks');
    }
    projects.push(project);
  }
  await soft('task progress and comments', async () => {
    for (const project of projects) {
      for (const [t, task] of project.tasks.entries()) {
        const worker = task.people[0];
        if (!worker || t > 2) continue;
        await worker.browser.post(`/tasks/${task.id}/status`, { status: 'in_progress' });
        await worker.browser.post(`/tasks/${task.id}/comments`, {
          body:
            t === 0
              ? 'Fieldwork started; client sent the trial balance.'
              : 'Working on it — first draft by Thursday.',
        });
        count('task comments');
        if (t === 0 && project.tasks.length > 2) {
          await worker.browser.post(`/tasks/${task.id}/status`, { status: 'in_review' });
          await project.manager.browser.post(`/tasks/${task.id}/status`, { status: 'completed' });
          count('tasks completed');
        }
      }
    }
  });

  // Leave (before time, so nobody logs hours on a day off) ------------------------------
  log('• leave');
  const daysOff = new Map<string, Set<string>>();
  const off = (m: Member, from: string, to: string) => {
    const set = daysOff.get(m.key) ?? new Set<string>();
    for (let d = from; d <= to; d = addDays(d, 1)) set.add(d);
    daysOff.set(m.key, set);
  };
  await soft('leave', async () => {
    const types = (await maryam.browser.get('/leave/types')) as {
      items: { id: string; code: string }[];
    };
    const type = (code: string) => types.items.find((t) => t.code === code)?.id ?? '';
    const apply = async (
      m: Member,
      code: string,
      from: string,
      to: string,
      reason: string,
      fileId?: string,
    ) =>
      m.browser.post('/leave/requests', {
        leaveTypeId: type(code),
        startDate: from,
        endDate: to,
        reason,
        ...(fileId ? { fileId } : {}),
      });
    const sunday = addDays(day(), -((weekday(day()) + 7) % 7) - 14);
    // Omar: annual leave two weeks ago (approved by his team lead).
    const a = await apply(
      by('omar'),
      'annual',
      addDays(sunday, 1),
      addDays(sunday, 3),
      'Family trip',
    );
    await sara.browser.post(`/leave/requests/${a.id}/approve`, { note: 'Enjoy!' });
    off(by('omar'), addDays(sunday, 1), addDays(sunday, 3));
    // Mohammed: sick day last week, with a doctor's note.
    const note = await by('mohammed').browser.upload('Medical certificate.pdf');
    const s = await apply(
      by('mohammed'),
      'sick',
      addDays(sunday, 9),
      addDays(sunday, 9),
      'Flu',
      note,
    );
    await maryam.browser.post(`/leave/requests/${s.id}/approve`);
    off(by('mohammed'), addDays(sunday, 9), addDays(sunday, 9));
    // Rahul: approved annual leave later this month.
    const r = await apply(
      by('rahul'),
      'annual',
      addDays(day(), 12),
      addDays(day(), 16),
      'Visiting family in Kerala',
    );
    await priya.browser.post(`/leave/requests/${r.id}/approve`);
    // Dana: waiting for approval.
    await apply(by('dana'), 'annual', addDays(day(), 30), addDays(day(), 34), 'Year-end break');
    // Fatima: rejected (busy season), then a shorter one approved.
    const f1 = await apply(
      by('fatima'),
      'annual',
      addDays(day(), 5),
      addDays(day(), 9),
      'Short holiday',
    );
    await sara.browser.post(`/leave/requests/${f1.id}/reject`, {
      note: 'Inventory count that week — please pick another date.',
    });
    const f2 = await apply(
      by('fatima'),
      'annual',
      addDays(day(), 20),
      addDays(day(), 20),
      'Personal errand',
    );
    await sara.browser.post(`/leave/requests/${f2.id}/approve`);
    count('leave requests', 6);
  });

  // Time: four past weeks (most approved, the last one waiting) and this week as drafts -----
  log('• timesheets (this takes a minute)');
  const thisSunday = addDays(day(), -weekday(day()));
  const loggers = [sara, ...staff];
  const entriesByWeek = new Map<string, { id: string; project: Project; who: Member }[]>();
  for (const who of loggers) {
    const mine = projects.flatMap((p) =>
      p.tasks.filter((t) => t.people.includes(who)).map((t) => ({ project: p, task: t })),
    );
    if (!mine.length) continue;
    let n = 0;
    for (let w = 4; w >= 0; w -= 1) {
      const weekStart = addDays(thisSunday, -7 * w);
      const list = entriesByWeek.get(weekStart) ?? [];
      for (let d = 0; d < 5; d += 1) {
        const date = addDays(weekStart, d);
        if (date >= day() || !isWorkday(date) || daysOff.get(who.key)?.has(date)) continue;
        const first = mine[n % mine.length];
        const second = mine[(n + 1) % mine.length];
        n += 1;
        const split =
          mine.length > 1
            ? [
                [first, 5],
                [second, 2.5],
              ]
            : [[first, 7]];
        for (const [pick, hours] of split as [typeof first, number][]) {
          if (!pick) continue;
          const res = await who.browser.send('POST', '/time-entries', {
            taskId: pick.task.id,
            workDate: date,
            hours: String(hours + ((n % 3) - 1) * 0.5),
            billable: pick.project.method !== 'non_billable',
            description: `${pick.task.title} — ${['fieldwork', 'documentation', 'client follow-up', 'review notes'][n % 4]}`,
          });
          if (res.status !== 201) {
            notes.push(
              `time entry ${who.key} ${date}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
            );
            continue;
          }
          list.push({ id: res.body.id, project: pick.project, who });
          count('time entries');
        }
      }
      entriesByWeek.set(weekStart, list);
    }
  }
  await soft('timesheet submissions and approvals', async () => {
    for (let w = 4; w >= 1; w -= 1) {
      const weekStart = addDays(thisSunday, -7 * w);
      const list = entriesByWeek.get(weekStart) ?? [];
      for (const who of loggers) {
        if (!list.some((e) => e.who === who)) continue;
        if (w === 1 && who.key === 'fatima') continue; // still a draft: reminder material
        const sheet = await who.browser.get(`/timesheets/mine?week=${weekStart}`);
        await who.browser.post(`/timesheets/${sheet.id}/submit`);
        count('timesheets submitted');
      }
      if (w === 1) continue; // last week waits for the managers
      for (const project of projects) {
        const ids = list.filter((e) => e.project === project).map((e) => e.id);
        if (!ids.length) continue;
        if (w === 2 && project === projects[1]) {
          const [first, ...rest] = ids;
          if (first) {
            await project.manager.browser.post('/time-entries/reject', {
              ids: [first],
              reason: 'Please split fieldwork and travel time.',
            });
            count('time entries rejected');
          }
          if (rest.length)
            await project.manager.browser.post('/time-entries/approve', { ids: rest });
          count('time entries approved', rest.length);
          continue;
        }
        await project.manager.browser.post('/time-entries/approve', { ids });
        count('time entries approved', ids.length);
      }
    }
  });

  // Attendance: approved corrections for the last two weeks, check-ins today ------------
  log('• attendance');
  await soft('attendance', async () => {
    for (const [k, who] of [sara, ...staff].entries()) {
      for (let d = 1; d <= 10; d += 1) {
        const date = addDays(day(), -d);
        if (!isWorkday(date) || daysOff.get(who.key)?.has(date)) continue;
        const inAt = `0${7 + ((d + k) % 3 === 0 ? 1 : 0)}:${String(30 + ((d * 7 + k * 5) % 28)).padStart(2, '0')}`;
        const outAt = `${16 + ((d + k) % 2)}:${String((d * 11 + k) % 50).padStart(2, '0')}`;
        for (const [kind, time] of [
          ['in', inAt],
          ['out', outAt],
        ] as const) {
          const c = await who.browser.post('/attendance/corrections', {
            kind,
            at: kuwaitTime(date, time),
            reason: 'Demo history (kiosk records imported)',
          });
          await maryam.browser.post(`/attendance/corrections/${c.id}/approve`, {});
          count('attendance records');
        }
      }
    }
    for (const who of [sara, ...staff.slice(0, 3), yousef]) {
      await who.browser.post('/attendance/check', {});
      count('check-ins today');
    }
  });

  // Billing ----------------------------------------------------------------------------
  log('• invoices and payments');
  await soft('invoices', async () => {
    const fin = ahmed.browser;
    const invoice = async (p: Project, lines: Json[], notesText: string) =>
      fin.post('/invoices', { clientId: p.clientId, projectId: p.id, notes: notesText, lines });
    const [gulf, bayan, wataniya, sadeem, marina, bay] = projects;
    // Paid in full.
    if (gulf) {
      const inv = await invoice(
        gulf,
        [{ description: 'Audit fee — 40% on signing', quantity: '1', unitPrice: '7200.000' }],
        'First instalment per engagement letter.',
      );
      await fin.post(`/invoices/${inv.id}/issue`, { issueDate: day(-58), dueDate: day(-28) });
      await fin.post(`/invoices/${inv.id}/payments`, {
        amount: '7200.000',
        receivedOn: day(-31),
        method: 'bank_transfer',
        reference: 'NBK TT 448120',
      });
      count('invoices');
      count('payments');
    }
    // Overdue, unpaid.
    if (wataniya) {
      const inv = await invoice(
        wataniya,
        [
          { description: 'Risk workshops (phase 1)', quantity: '1', unitPrice: '6000.000' },
          { description: 'Workshop materials', quantity: '4', unitPrice: '125.000' },
        ],
        'Phase 1 milestone.',
      );
      await fin.post(`/invoices/${inv.id}/issue`, { issueDate: day(-50), dueDate: day(-20) });
      count('invoices');
    }
    // Partly paid.
    if (marina) {
      const inv = await invoice(
        marina,
        [
          {
            description: 'Revenue cycle audit — fieldwork',
            quantity: '1',
            unitPrice: '4320.000',
            discountPercent: '5',
          },
        ],
        '',
      );
      await fin.post(`/invoices/${inv.id}/issue`, { issueDate: day(-20), dueDate: day(10) });
      await fin.post(`/invoices/${inv.id}/payments`, {
        amount: '2000.000',
        receivedOn: day(-6),
        method: 'knet',
        reference: 'KNET 99120034',
      });
      count('invoices');
      count('payments');
    }
    // Retainer, issued this month, not yet due.
    if (bay) {
      const inv = await invoice(
        bay,
        [
          {
            description: 'Monthly bookkeeping retainer — October',
            quantity: '1',
            unitPrice: '500.000',
          },
        ],
        '',
      );
      await fin.post(`/invoices/${inv.id}/issue`, { issueDate: day(-2), dueDate: day(28) });
      count('invoices');
    }
    // From approved time (time & materials).
    for (const p of [bayan, sadeem]) {
      if (!p) continue;
      const inv = await fin.post('/invoices/from-time', {
        projectId: p.id,
        from: day(-40),
        to: day(-1),
        hourlyRate: '45.000',
        includeExpenses: false,
      });
      count('invoices from time');
      if (p === sadeem) {
        await fin.post(`/invoices/${inv.id}/issue`, { issueDate: day(-5), dueDate: day(25) });
      }
    }
    // A draft still being prepared.
    if (gulf) {
      await invoice(
        gulf,
        [{ description: 'Audit fee — 60% on final report', quantity: '1', unitPrice: '10800.000' }],
        'To issue with the signed report.',
      );
      count('invoices');
    }
  });

  // Expenses -----------------------------------------------------------------------------
  log('• expenses');
  await soft('expenses', async () => {
    const claim = async (who: Member, title: string, lines: Json[]) => {
      const withReceipts: Json[] = [];
      for (const line of lines) {
        const big = Number(line.amount) > 5;
        withReceipts.push(
          big
            ? {
                ...line,
                receiptFileId: await who.browser.upload(`Receipt ${String(line.description)}.pdf`),
              }
            : line,
        );
      }
      const c = await who.browser.post('/expenses', { title, lines: withReceipts });
      await who.browser.post(`/expenses/${c.id}/submit`);
      count('expense claims');
      return c.id;
    };
    const [gulf, , wataniya] = projects;
    const omar = by('omar');
    const c1 = await claim(omar, 'Inventory count — transport and meals', [
      {
        spentOn: day(-12),
        category: 'transport',
        description: 'Taxi to Shuwaikh warehouse',
        amount: '4.500',
        projectId: gulf?.id ?? null,
        billable: true,
      },
      {
        spentOn: day(-12),
        category: 'meals',
        description: 'Team lunch during count',
        amount: '18.750',
        projectId: gulf?.id ?? null,
        billable: false,
      },
    ]);
    await sara.browser.post(`/expenses/${c1}/approve`, { note: 'OK' });
    await ahmed.browser.post(`/expenses/${c1}/reimburse`, {
      reimbursedOn: day(),
      method: 'bank_transfer',
      reference: 'Payroll batch 10',
    });
    const rahul = by('rahul');
    const c2 = await claim(rahul, 'Client workshop supplies', [
      {
        spentOn: day(-8),
        category: 'office',
        description: 'Printed workshop packs',
        amount: '32.000',
        projectId: wataniya?.id ?? null,
        billable: true,
      },
    ]);
    await priya.browser.post(`/expenses/${c2}/approve`);
    await claim(by('dana'), 'Ministry certificate fees', [
      {
        spentOn: day(-2),
        category: 'government_fees',
        description: 'Certified copies of CR extract',
        amount: '12.000',
        projectId: null,
        billable: false,
      },
    ]);
  });

  // Announcement -------------------------------------------------------------------------
  await soft('announcement', async () => {
    const preview = await owner.browser.post('/announcements/preview', { roles: [] });
    await owner.browser.post('/announcements', {
      titleEn: 'Busy season starts next week',
      titleAr: 'يبدأ موسم الذروة الأسبوع القادم',
      bodyEn:
        'Please submit your timesheets every Thursday and plan any leave with your team lead. Thank you all for a strong year.',
      bodyAr:
        'يرجى تقديم سجلات الوقت كل يوم خميس وتنسيق الإجازات مع قائد الفريق. شكرًا لكم جميعًا على عام مميز.',
      roles: [],
      email: false,
      confirmRecipients: preview.recipients,
    });
    count('announcements');
  });

  // Payroll: salaries and a TEST run for last month ------------------------------------
  log('• payroll (test run)');
  await soft('payroll', async () => {
    for (const p of people) {
      await maryam.browser.post('/payroll/salaries', {
        membershipId: p.membershipId,
        effectiveFrom: `${year}-01-01` > p.joinDate ? `${year}-01-01` : p.joinDate,
        basic: p.basic,
        allowances: [
          { code: 'housing', label: 'Housing', amount: p.housing },
          { code: 'transport', label: 'Transport', amount: '50.000' },
        ],
        socialInsurance: !['priya', 'rahul', 'ahmed', 'mohammed'].includes(p.key),
      });
      count('salaries');
    }
    const last = new Date(`${day()}T00:00:00Z`);
    last.setUTCDate(1);
    last.setUTCMonth(last.getUTCMonth() - 1);
    const period = last.toISOString().slice(0, 7);
    const run = await maryam.browser.post('/payroll/runs', { period });
    await maryam.browser.put(`/payroll/runs/${run.id}/inputs`, {
      inputs: [
        {
          membershipId: by('omar').membershipId,
          kind: 'bonus',
          value: '100.000',
          note: 'Inventory count weekend',
        },
      ],
    });
    await maryam.browser.post(`/payroll/runs/${run.id}/calculate`);
    await maryam.browser.post(`/payroll/runs/${run.id}/submit`);
    await ceo.browser.post(`/payroll/runs/${run.id}/approve`);
    count('payroll runs (test)');
  });

  // Credentials ------------------------------------------------------------------------
  const rows = people.map((p) => ({
    role: p.role,
    name: p.name,
    email: p.email,
    twoFactor: p.twoFactor,
  }));
  const lines: string[] = [
    `# Demo company "${SLUG}" — local development only`,
    '',
    `Created ${new Date().toISOString()} by \`pnpm demo:seed\`. Fictional people and data.`,
    `Every password: \`${PASSWORD}\``,
    '',
    `Sign in: ${WEB}/sign-in → pick the company (or go straight to http://${HOST}:5173).`,
    '',
    '| Role | Name | Email | Two-factor |',
    '|---|---|---|---|',
    ...rows.map(
      (r) => `| ${r.role} | ${r.name} | ${r.email} | ${r.twoFactor ? 'yes (see below)' : 'no'} |`,
    ),
    '',
    '## Two-factor secrets',
    '',
    'Add the secret to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …) —',
    'or use one of the backup codes (each works once).',
    '',
  ];
  for (const r of rows) {
    if (!r.twoFactor) continue;
    const secret = new URL(r.twoFactor.totpUri).searchParams.get('secret') ?? '';
    lines.push(
      `### ${r.name} (${r.role}) — ${r.email}`,
      '',
      `- Secret: \`${secret}\``,
      `- otpauth URI: \`${r.twoFactor.totpUri}\``,
      `- Backup codes: ${r.twoFactor.backupCodes.map((c) => `\`${c}\``).join(' ')}`,
      '',
    );
  }
  lines.push('## What was created', '', ...Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`));
  if (notes.length) lines.push('', '## Skipped', '', ...notes.map((n) => `- ${n}`));
  const file = resolve(
    ROOT,
    SLUG === 'alnoor' ? 'demo-credentials.local.md' : `demo-credentials.${SLUG}.local.md`,
  );
  writeFileSync(file, `${lines.join('\n')}\n`);

  log('\n✔ Demo data ready.\n');
  log(lines.slice(4).join('\n'));
  log(`\nSaved to ${file} (git-ignored).`);
  log(`Open ${WEB}/sign-in  ·  company: http://${HOST}:5173`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
