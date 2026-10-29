import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { type Locale, type MessageKey, type MessageParams, translate } from '@ultimate-erp/i18n';
import { deleteEmailsTo, linkFromEmail, resetDevRateLimits, totpNow } from './support/dev-stack.js';

// Milestone 1.4b acceptance (docs/modules/web-ui.md §8): the whole first-day journey in each
// language against the real dev stack (`pnpm dev`): sign up → confirm email → sign in → create
// a company → secure hand-off → two-factor setup → invite → the invitee joins. axe checks every
// screen. Run with `pnpm e2e:journey`.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page: Page, screen: string) {
  await page.evaluate(() => document.fonts.ready);
  // Let colour transitions finish (in-app navigation fades the highlight of the old page);
  // a cancelled one (its element left the page) is simply ignored.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    results.violations.map(
      (v) =>
        `${screen} — ${v.id}: ${v.nodes.length} × ${v.help} — ${v.nodes
          .slice(0, 3)
          .map((node) => node.target.join(' '))
          .join(' | ')}`,
    ),
  ).toEqual([]);
}

async function newPage(browser: Browser, locale: Locale) {
  const context = await browser.newContext();
  await context.addInitScript((l) => {
    localStorage.setItem('erp.locale', l);
  }, locale);
  return context.newPage();
}

test.beforeAll(resetDevRateLimits);

for (const locale of ['en', 'ar'] as const) {
  test(`first-day journey — ${locale}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const t = (key: MessageKey, params?: MessageParams) => translate(locale, key, params);
    const run = `${locale}${Date.now().toString(36)}`;
    const slug = `e2e-${run}`;
    const owner = {
      name: `Owner ${run}`,
      email: `owner-${run}@example.test`,
      password: `owner pass ${run} long`,
    };
    const invitee = {
      name: `Colleague ${run}`,
      email: `colleague-${run}@example.test`,
      password: `colleague pass ${run} long`,
    };

    try {
      // --- Owner: sign up and confirm the email address ------------------------------------
      const page = await newPage(browser, locale);
      await page.goto('/sign-up');
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expectAccessible(page, 'sign-up');
      await page.getByLabel(t('ui.auth.name')).fill(owner.name);
      await page.getByLabel(t('ui.auth.email')).fill(owner.email);
      await page.getByLabel(t('ui.auth.password'), { exact: true }).fill(owner.password);
      await page.getByRole('button', { name: t('ui.auth.signUpSubmit') }).click();
      await expect(page.getByRole('heading', { name: t('ui.auth.checkEmailTitle') })).toBeVisible();
      await expectAccessible(page, 'check-email');

      await page.goto(await linkFromEmail(owner.email, '/verify-email?token='));
      await expect(page.getByRole('heading', { name: t('ui.auth.verifiedTitle') })).toBeVisible();
      await expectAccessible(page, 'verify-email');

      // --- Sign in on the main address and create a company --------------------------------
      await page.getByRole('link', { name: t('ui.auth.signInSubmit') }).click();
      await expectAccessible(page, 'sign-in');
      await page.getByLabel(t('ui.auth.email')).fill(owner.email);
      await page.getByLabel(t('ui.auth.password'), { exact: true }).fill(owner.password);
      await page.getByRole('button', { name: t('ui.auth.signInSubmit') }).click();
      await expect(page.getByRole('heading', { name: t('ui.companies.title') })).toBeVisible();
      await expectAccessible(page, 'companies');

      await page.getByLabel(t('ui.companies.nameEn')).fill(`Firm ${run}`);
      await page.getByLabel(t('ui.companies.nameAr')).fill(`شركة ${run}`);
      await page.getByLabel(t('ui.companies.slug')).fill(slug);
      await page.getByRole('button', { name: t('ui.companies.createSubmit') }).click();

      // Hand-off lands on the company's own address; Owner is a sensitive role → two-factor first.
      await page.waitForURL(`http://${slug}.localhost:5173/account`);
      await expect(
        page.getByRole('alert').filter({ hasText: t('ui.account.mfaRequired') }),
      ).toBeVisible();
      await expectAccessible(page, 'account (two-factor required)');

      await page.getByRole('button', { name: t('ui.account.setUp') }).click();
      await page.getByLabel(t('ui.auth.password'), { exact: true }).fill(owner.password);
      await page.getByRole('button', { name: t('ui.account.continue') }).click();
      const secret = (await page.getByTestId('totp-secret').textContent()) ?? '';
      await expect(page.getByTestId('backup-codes').getByRole('listitem')).toHaveCount(10);
      await expectAccessible(page, 'two-factor setup');
      await page.getByLabel(t('ui.account.confirmCode')).fill(await totpNow(secret));
      await page.getByRole('button', { name: t('ui.account.enable') }).click();
      await expect(page.getByText(t('ui.account.mfaOn'))).toBeVisible();

      // --- Dashboard → invite a colleague ---------------------------------------------------
      await page.getByRole('link', { name: t('ui.shell.dashboard') }).click();
      await expect(page.getByText(t('ui.dashboard.emptyTitle'))).toBeVisible();
      await expectAccessible(page, 'dashboard');

      // --- Phase 2a shell: command palette (Ctrl K) and the phone layout ---------------------
      await page.keyboard.press('Control+k');
      const palette = page.getByRole('dialog', { name: t('ui.palette.title') });
      await expect(palette.getByRole('combobox')).toBeFocused();
      await expectAccessible(page, 'command palette');
      await palette.getByRole('combobox').fill(t('ui.shell.members'));
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: t('ui.members.title') })).toBeVisible();
      await page.getByRole('link', { name: t('ui.shell.home') }).click();
      await expect(page.getByText(t('ui.dashboard.emptyTitle'))).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: t('ui.shell.openMenu') }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('link', { name: t('ui.shell.members') })).toBeVisible();
      await expectAccessible(page, 'phone menu');
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1280, height: 800 });

      // Dashboard (Phase 2b): real set-up progress — company created and two-factor on.
      await expect(page.getByText(t('ui.dashboard.progress', { done: 2, total: 4 }))).toBeVisible();
      await expect(
        page.getByText(
          t('ui.dashboard.activityText.access_company_created', { actor: owner.name }),
        ),
      ).toBeVisible();
      await page.screenshot({ path: `e2e/screenshots/dashboard-${locale}.png`, fullPage: true });
      await page.getByRole('link', { name: t('ui.dashboard.actionMembers') }).click();
      await expect(page.getByRole('heading', { name: t('ui.members.title') })).toBeVisible();
      await expect(page.getByRole('cell', { name: owner.email })).toBeVisible();
      await expectAccessible(page, 'members');

      await page.getByRole('button', { name: t('ui.members.invite') }).click();
      const dialog = page.getByRole('dialog');
      await expectAccessible(page, 'invite dialog');
      await dialog.getByLabel(t('ui.auth.email')).fill(invitee.email);
      await dialog.getByRole('button', { name: t('ui.members.sendInvite') }).click();
      await expect(
        page.getByText(t('ui.members.invited', { email: invitee.email }), { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(invitee.email, { exact: true })).toBeVisible();

      // --- Invitee: open the email link, create an account, sign in, accept ------------------
      const inviteLink = await linkFromEmail(invitee.email, '/invitations/accept?token=');
      expect(new URL(inviteLink).host).toBe(`${slug}.localhost:5173`);
      const guest = await newPage(browser, locale);
      await guest.goto(inviteLink);
      await expect(guest.getByRole('heading', { name: t('ui.invitation.title') })).toBeVisible();
      await expectAccessible(guest, 'invitation');

      await guest.getByRole('link', { name: t('ui.invitation.createToAccept') }).click();
      await guest.getByLabel(t('ui.auth.name')).fill(invitee.name);
      await guest.getByLabel(t('ui.auth.email')).fill(invitee.email);
      await guest.getByLabel(t('ui.auth.password'), { exact: true }).fill(invitee.password);
      await guest.getByRole('button', { name: t('ui.auth.signUpSubmit') }).click();
      await expect(
        guest.getByRole('heading', { name: t('ui.auth.checkEmailTitle') }),
      ).toBeVisible();

      // The confirmation link opens in another tab, as it would from a mail app.
      const mailTab = await guest.context().newPage();
      await mailTab.goto(await linkFromEmail(invitee.email, '/verify-email?token='));
      await expect(
        mailTab.getByRole('heading', { name: t('ui.auth.verifiedTitle') }),
      ).toBeVisible();
      await mailTab.close();

      await guest.getByRole('link', { name: t('ui.auth.backToSignIn') }).click();
      await expect(
        guest.getByRole('heading', {
          name: t('ui.auth.signInTo', { company: locale === 'ar' ? `شركة ${run}` : `Firm ${run}` }),
        }),
      ).toBeVisible();
      await guest.getByLabel(t('ui.auth.email')).fill(invitee.email);
      await guest.getByLabel(t('ui.auth.password'), { exact: true }).fill(invitee.password);
      await guest.getByRole('button', { name: t('ui.auth.signInSubmit') }).click();
      await guest.getByRole('button', { name: t('ui.invitation.accept') }).click();
      await expect(guest.getByText(t('ui.dashboard.emptyTitle'))).toBeVisible();
      // An Employee cannot see the member list, so the sidebar does not offer it.
      await expect(guest.getByRole('link', { name: t('ui.shell.members') })).toHaveCount(0);
      await expectAccessible(guest, 'dashboard (employee)');

      // --- Owner sees the new member ---------------------------------------------------------
      await page.reload();
      await expect(page.getByRole('cell', { name: invitee.email })).toBeVisible();

      // --- …and is notified (Milestone 1.5a): bell → panel → open → read --------------------
      const bell = page.getByRole('button', { name: t('ui.notifications.open', { count: 1 }) });
      await bell.click();
      const joined = t('ui.notifications.types.access_member_joined', { name: invitee.name });
      await expect(page.getByRole('dialog').getByText(joined)).toBeVisible();
      await expectAccessible(page, 'notifications panel');
      await page.getByRole('dialog').getByText(joined).click();
      await expect(page.getByRole('heading', { name: t('ui.members.title') })).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('ui.notifications.open', { count: 0 }) }),
      ).toBeVisible();

      // --- Owner changes their password from My account --------------------------------------
      await page.getByRole('link', { name: t('ui.shell.myAccount') }).click();
      await expectAccessible(page, 'my account');
      await page.getByLabel(t('ui.account.currentPassword')).fill(owner.password);
      await page
        .getByLabel(t('ui.account.newPassword'), { exact: true })
        .fill(`${owner.password} v2`);
      await page.getByRole('button', { name: t('ui.account.changePassword') }).click();
      await expect(page.getByText(t('ui.account.passwordChanged'), { exact: true })).toBeVisible();
    } finally {
      await deleteEmailsTo(owner.email, invitee.email);
    }
  });
}
