import { request } from 'node:http';
import { expect, test } from '@playwright/test';
import { AUTH_STATE_HEADER } from '@ultimate-erp/contracts';
import { type MessageKey, type MessageParams, translate } from '@ultimate-erp/i18n';
import {
  deleteEmailsTo,
  linkFromEmail,
  resetDevRateLimits,
  totpNow,
  waitForSteadyApi,
} from './support/dev-stack.js';

// Phase 16 (docs/modules/mobile.md §7.7): the mobile app, exported for the browser, signs in
// through the header-held session, passes two-factor, enters a company with a hand-off ticket,
// checks in, and reads tasks and leave — all against the real dev API. Run with `pnpm e2e:mobile`.

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A cookie-less API caller for the set-up steps: the same transport the app uses. `host` picks
 * the company address (Node does not resolve *.localhost and `fetch` ignores a Host header, so
 * this uses the plain http module, which honours it).
 */
function headerClient(host?: string) {
  let state = '';
  return (path: string, body?: object) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          host: 'localhost',
          port: 5173,
          path: `/api/v1${path}`,
          method: payload === undefined ? 'GET' : 'POST',
          headers: {
            [AUTH_STATE_HEADER]: state,
            ...(host === undefined ? {} : { Host: host }),
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
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
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
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`${path} → ${res.statusCode} ${JSON.stringify(data)}`));
              return;
            }
            resolve(data as Record<string, unknown>);
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

for (const locale of ['en', 'ar'] as const) {
  test(`mobile app — sign in, two-factor, company, check in, tasks, leave, sign out — ${locale}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const t = (key: MessageKey, params?: MessageParams) => translate(locale, key, params);
    // Same preference key as the web app's browser storage: the app reads it on the web.
    await page.addInitScript((l) => {
      localStorage.setItem('erp.locale', l);
    }, locale);
    const run = `m${Date.now().toString(36)}`;
    const email = `mobile-${run}@example.test`;
    const password = `mobile pass ${run} long`;
    const slug = `e2e-${run}`;

    try {
      // --- Set-up through the API: account, company, two-factor (as an Owner needs) -----------
      const main = headerClient();
      await main('/auth/sign-up', { email, password, name: `Mobile ${run}`, locale: 'en' });
      const verify = await linkFromEmail(email, '/verify-email?token=');
      const token = new URL(verify).searchParams.get('token') ?? '';
      await main(`/auth/verify-email?token=${encodeURIComponent(token)}`);
      await main('/auth/sign-in', { email, password, rememberMe: true });
      const created = await main('/companies', {
        slug,
        nameEn: `Firm ${run}`,
        nameAr: `شركة ${run}`,
      });
      const setup = await main('/auth/two-factor/enable', { password });
      const secret = new URL(String(setup.totpUri)).searchParams.get('secret') ?? '';
      const confirmedAt = Math.floor(Date.now() / 30_000);
      await main('/auth/two-factor/confirm', { code: await totpNow(secret) });
      // Attendance is recorded against an employee record: give the owner one (as HR would).
      const company = headerClient(`${slug}.localhost:5173`);
      const { url } = await main('/auth/handoff', { tenantId: String(created.tenantId) });
      const ticket = new URL(String(url)).searchParams.get('ticket') ?? '';
      await company('/auth/handoff/redeem', { ticket });
      const { members } = (await company('/members')) as {
        members: { membershipId: string; email: string }[];
      };
      const me = members.find((m) => m.email === email);
      if (!me) throw new Error('owner is not a member of their own company');
      await company('/people', { membershipId: me.membershipId });
      await company('/auth/sign-out', {});
      await main('/auth/sign-out', {});

      // --- The app: sign in ------------------------------------------------------------------
      await page.goto('/');
      await expect(page.getByRole('heading', { name: t('ui.auth.signInTitle') })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await page.getByTestId('email').fill(email);
      await page.getByTestId('password').fill(password);
      await page.getByTestId('sign-in').click();

      // --- Two-factor: each code works once, so wait for the window after the set-up code -----
      await expect(page.getByRole('heading', { name: t('ui.auth.twoFactorTitle') })).toBeVisible();
      while (Math.floor(Date.now() / 30_000) === confirmedAt) {
        await page.waitForTimeout(1000);
      }
      await page.getByTestId('code').fill(await totpNow(secret));
      await page.getByTestId('verify').click();

      // --- Company -----------------------------------------------------------------------------
      await expect(
        page.getByRole('heading', { name: t('ui.mobile.companiesTitle') }),
      ).toBeVisible();
      await expect(page.getByText(t('ui.mobile.signedInAs', { email }))).toBeVisible();
      await page.getByTestId(`company-${slug}`).click();

      // --- Home: greeting, company, check in -------------------------------------------------
      await expect(page.getByText(`Mobile ${run}`)).toBeVisible();
      await expect(page.getByText(locale === 'ar' ? `شركة ${run}` : `Firm ${run}`)).toBeVisible();
      await expect(page.getByText(t('ui.mobile.notInYet'))).toBeVisible();
      await page.getByTestId('check').click();
      const inSince = t('ui.mobile.checkedInSince', { time: '' }).trim();
      await expect(page.getByText(new RegExp('^' + escapeRegExp(inSince)))).toBeVisible();

      // --- Attendance tab: today's event is listed -------------------------------------------
      await page.getByRole('tab', { name: t('ui.shell.attendance') }).click();
      await expect(
        page.getByText(new RegExp('^' + escapeRegExp(t('ui.attendance.kind.in')) + ' · ')),
      ).toBeVisible();
      await expect(page.getByText(t('ui.attendance.lastTwoWeeks'))).toBeVisible();

      // --- Tasks tab: honest empty state -----------------------------------------------------
      await page.getByRole('tab', { name: t('ui.shell.tasks') }).click();
      await expect(page.getByText(t('ui.tasks.empty'))).toBeVisible();

      // --- Leave tab: balances from the company's (flagged) default types ----------------------
      await page.getByRole('tab', { name: t('ui.shell.leave') }).click();
      await expect(page.getByRole('button', { name: t('ui.leave.apply') })).toBeVisible();
      await expect(page.getByText(t('ui.leave.noRequests'))).toBeVisible();

      // --- Notifications and account; sign out --------------------------------------------------
      await page.getByRole('tab', { name: t('ui.mobile.home') }).click();
      await page.getByTestId('bell').click();
      await expect(page.getByRole('heading', { name: t('ui.notifications.title') })).toBeVisible();
      // The stack header's back button (the app has no browser URLs).
      await page.getByRole('link', { name: /back/i }).click();
      await page.getByTestId('account').click();
      await expect(page.getByText(email)).toBeVisible();
      await page.getByTestId('sign-out').click();
      await expect(page.getByRole('heading', { name: t('ui.auth.signInTitle') })).toBeVisible();

      // The device holds no session any more: a reload stays on sign-in.
      await page.reload();
      await expect(page.getByRole('heading', { name: t('ui.auth.signInTitle') })).toBeVisible();
    } finally {
      await deleteEmailsTo(email);
    }
  });
}
