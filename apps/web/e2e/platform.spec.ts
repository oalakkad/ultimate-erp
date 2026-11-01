import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { AUTH_STATE_HEADER } from '@ultimate-erp/contracts';
import { type Locale, type MessageKey, type MessageParams, translate } from '@ultimate-erp/i18n';
import {
  deleteEmailsTo,
  linkFromEmail,
  resetDevRateLimits,
  totpNow,
  waitForSteadyApi,
} from './support/dev-stack.js';

// Phase 17 (docs/modules/platform.md §7): the founder's console in a real browser against the dev
// stack. The founder is granted the way it happens on a server — through the command-line tool,
// never through the API. Run with `pnpm e2e:journey` (part of the journey project).

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** API calls without cookies (the same header transport the mobile app uses). */
function headerClient() {
  let state = '';
  return (path: string, body?: object) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(
        {
          host: 'localhost',
          port: 5173,
          path: `/api/v1${path}`,
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            [AUTH_STATE_HEADER]: state,
            ...(payload === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(payload),
                }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const next = res.headers[AUTH_STATE_HEADER];
            if (typeof next === 'string') state = next;
            const text = Buffer.concat(chunks).toString('utf8');
            let data: unknown;
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
            if ((res.statusCode ?? 500) >= 400)
              reject(new Error(`${path} → ${res.statusCode} ${text}`));
            else resolve(data as Record<string, unknown>);
          });
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await waitForSteadyApi();
  await resetDevRateLimits();
});

for (const locale of ['en', 'ar'] as const satisfies readonly Locale[]) {
  test(`platform console — ${locale}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const t = (key: MessageKey, params?: MessageParams) => translate(locale, key, params);
    const run = `p${Date.now().toString(36)}`;
    const email = `founder-${run}@example.test`;
    const password = `founder pass ${run} long`;
    const slug = `e2e-${run}`;
    try {
      // --- A founder account and a throwaway company, through the API -------------------------
      const api = headerClient();
      await api('/auth/sign-up', { email, password, name: `Founder ${run}`, locale });
      const token =
        new URL(await linkFromEmail(email, '/verify-email?token=')).searchParams.get('token') ?? '';
      await api(`/auth/verify-email?token=${encodeURIComponent(token)}`);
      await api('/auth/sign-in', { email, password, rememberMe: true });
      await api('/companies', { slug, nameEn: `Firm ${run}`, nameAr: `شركة ${run}` });
      const setup = await api('/auth/two-factor/enable', { password });
      const secret = new URL(String(setup.totpUri)).searchParams.get('secret') ?? '';
      const confirmedAt = Math.floor(Date.now() / 30_000);
      await api('/auth/two-factor/confirm', { code: await totpNow(secret) });
      await api('/auth/sign-out', {});
      // The grant: the command-line tool as the migrator (built by `pnpm build`).
      const out = execFileSync(
        'node',
        ['--env-file=../../.env', '../api/dist/ops/cli.js', 'founder', email],
        { encoding: 'utf8' },
      );
      expect(out).toContain('can now open the platform console');

      // --- Sign in on the web; the console link appears on the companies page -----------------
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await context.addInitScript((l) => {
        localStorage.setItem('erp.locale', l);
      }, locale);
      const page = await context.newPage();
      await page.goto('/sign-in');
      await page.getByLabel(t('ui.auth.email')).fill(email);
      await page.getByLabel(t('ui.auth.password'), { exact: true }).fill(password);
      await page.getByRole('button', { name: t('ui.auth.signInSubmit') }).click();
      await expect(page.getByRole('heading', { name: t('ui.auth.twoFactorTitle') })).toBeVisible();
      while (Math.floor(Date.now() / 30_000) === confirmedAt) {
        await page.waitForTimeout(1000);
      }
      await page.getByLabel(t('ui.auth.code')).fill(await totpNow(secret));
      await page.getByRole('button', { name: t('ui.auth.verify') }).click();
      await expect(page.getByRole('heading', { name: t('ui.companies.title') })).toBeVisible();
      await page.getByRole('link', { name: new RegExp(t('ui.platform.title')) }).click();

      // --- The console: overview, the company, suspend with a reason, reactivate --------------
      await expect(page.getByRole('heading', { name: t('ui.platform.title') })).toBeVisible();
      await expect(
        page
          .getByText(t('ui.platform.overview'))
          .or(page.getByText(t('ui.platform.companies')).first()),
      ).toBeVisible();
      await page.getByLabel(t('ui.platform.search')).fill(slug);
      const row = page
        .getByRole('row')
        .filter({ hasText: locale === 'ar' ? `شركة ${run}` : `Firm ${run}` });
      await expect(row).toBeVisible();
      await expect(row.getByText(t('ui.platform.active'))).toBeVisible();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `e2e/screenshots/platform-${locale}.png`, fullPage: true });
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.help} — ${v.nodes
              .slice(0, 2)
              .map((n) => n.target.join(' '))
              .join(' | ')}`,
        ),
      ).toEqual([]);

      await row.getByRole('button', { name: t('ui.platform.suspend') }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(t('ui.platform.reason')).fill('Browser test: unpaid');
      const axeDialog = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(axeDialog.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      await dialog.getByRole('button', { name: t('ui.platform.suspend') }).click();
      await expect(row.getByText(t('ui.platform.suspended'))).toBeVisible();
      // The founder's action is on record with its reason.
      await expect(
        page.getByText(t('ui.platform.reasonLine', { reason: 'Browser test: unpaid' })).first(),
      ).toBeVisible();
      // The suspended company's address answers 404 (checked through the API).
      const probe = await fetch(`http://localhost:5173/api/v1/tenant`, {
        headers: { host: `${slug}.localhost:5173` },
      }).catch(() => null);
      expect(probe === null || probe.status === 404).toBe(true);

      await row.getByRole('button', { name: t('ui.platform.reactivate') }).click();
      await page.getByRole('dialog').getByLabel(t('ui.platform.reason')).fill('Browser test: paid');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: t('ui.platform.reactivate') })
        .click();
      await expect(row.getByText(t('ui.platform.active'))).toBeVisible();
      await context.close();
    } finally {
      await deleteEmailsTo(email);
    }
  });
}
