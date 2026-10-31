import AxeBuilder from '@axe-core/playwright';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { type Locale, type MessageKey, type MessageParams, translate } from '@ultimate-erp/i18n';
import {
  deleteEmailsTo,
  linkFromEmail,
  resetDevRateLimits,
  totpNow,
  waitForSteadyApi,
} from './support/dev-stack.js';

// Milestone 1.4b acceptance (docs/modules/web-ui.md §8): the whole first-day journey in each
// language against the real dev stack (`pnpm dev`): sign up → confirm email → sign in → create
// a company → secure hand-off → two-factor setup → invite → the invitee joins. axe checks every
// screen. Run with `pnpm e2e:journey`.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectAccessible(page: Page, screen: string) {
  await page.evaluate(() => document.fonts.ready);
  // Let entrances and colour transitions finish — text fading in is not a contrast problem.
  // Things can start arriving a moment later (a toast after a save), so wait until a short
  // quiet period passes with no one-off animation running. Looping ones (skeleton shimmer)
  // never finish and are ignored.
  await page.waitForFunction(
    () => {
      const w = window as unknown as { quietSince?: number | undefined };
      const busy = document
        .getAnimations()
        .some(
          (a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity,
        );
      if (busy) w.quietSince = undefined;
      else w.quietSince ??= performance.now();
      return w.quietSince !== undefined && performance.now() - w.quietSince > 250;
    },
    undefined,
    { polling: 50, timeout: 10_000 },
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

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await waitForSteadyApi();
  await resetDevRateLimits();
});

for (const locale of ['en', 'ar'] as const) {
  test(`first-day journey — ${locale}`, async ({ browser }) => {
    test.setTimeout(360_000);
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
      await expect(
        page.getByRole('heading', { name: t('ui.dashboard.attention.title') }),
      ).toBeVisible();
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
      await expect(
        page.getByRole('heading', { name: t('ui.dashboard.attention.title') }),
      ).toBeVisible();

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
      await page.screenshot({
        path: `e2e/screenshots/dashboard-${locale}.png`,
        fullPage: true,
        animations: 'disabled',
      });
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
      await expect(
        guest.getByRole('heading', { name: t('ui.dashboard.attention.title') }),
      ).toBeVisible();
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

      // --- Phase 3: clients — create, contacts, communication, documents, activity, search -----
      const clientEn = `Al Noor Trading ${run}`;
      const clientAr = `شركة النور للتجارة ${run}`;
      await page.getByRole('link', { name: t('ui.shell.clients') }).click();
      await expect(page.getByRole('heading', { name: t('ui.clients.title') })).toBeVisible();
      await expect(page.getByText(t('ui.clients.empty'))).toBeVisible();
      await expectAccessible(page, 'clients (empty)');

      await page.getByRole('link', { name: t('ui.clients.new') }).click();
      await page.getByLabel(t('ui.clients.fields.legalNameEn')).fill(clientEn);
      await page.getByLabel(t('ui.clients.fields.legalNameAr')).fill(clientAr);
      await page.getByLabel(t('ui.clients.fields.commercialRegistration')).fill(`CR${run}`);
      await expectAccessible(page, 'new client');
      await page.getByRole('button', { name: t('ui.clients.create') }).click();
      const clientName = locale === 'ar' ? clientAr : clientEn;
      await expect(page.getByRole('heading', { name: clientName })).toBeVisible();
      await expectAccessible(page, 'client overview');

      await page.getByRole('tab', { name: t('ui.clients.tabs.contacts') }).click();
      await page.getByRole('button', { name: t('ui.clients.contacts.add') }).click();
      const contactDialog = page.getByRole('dialog');
      await contactDialog.getByLabel(t('ui.clients.contacts.name')).fill('Sara Al-Mutairi');
      await contactDialog.getByRole('checkbox', { name: t('ui.clients.contacts.primary') }).click();
      await expectAccessible(page, 'add contact');
      await contactDialog.getByRole('button', { name: t('ui.clients.contacts.add') }).click();
      await expect(page.getByText('Sara Al-Mutairi')).toBeVisible();

      await page.getByRole('tab', { name: t('ui.clients.tabs.communication') }).click();
      await page
        .getByLabel(t('ui.clients.interactions.summary'))
        .fill('Agreed the audit scope for FY2026.');
      await page
        .getByRole('button', { name: t('ui.clients.interactions.log'), exact: true })
        .click();
      await expect(page.getByText('Agreed the audit scope for FY2026.')).toBeVisible();
      await expectAccessible(page, 'client communication');

      await page.getByRole('tab', { name: t('ui.clients.tabs.documents') }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: 'engagement-letter.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
      });
      await expect(page.getByText('engagement-letter.pdf')).toBeVisible();
      // The worker scans it with ClamAV, then the list refreshes by itself.
      await expect(
        page.getByText(t('ui.clients.documents.status.clean'), { exact: true }),
      ).toBeVisible({
        timeout: 60_000,
      });
      await expectAccessible(page, 'client documents');

      await page.getByRole('tab', { name: t('ui.clients.tabs.activity') }).click();
      await expect(
        page.getByText(t('ui.clients.activity.text.clients_client_created', { actor: owner.name })),
      ).toBeVisible();
      await expectAccessible(page, 'client activity');

      await page.getByRole('link', { name: t('ui.shell.clients') }).click();
      await page.getByLabel(t('ui.clients.search')).fill(clientAr);
      await expect(page.getByRole('link', { name: clientName })).toBeVisible();
      await expectAccessible(page, 'clients (list)');

      // Same name again → the duplicate warning, with the option to go ahead anyway.
      await page.getByRole('link', { name: t('ui.clients.new') }).click();
      await page.getByLabel(t('ui.clients.fields.legalNameEn')).fill(clientEn.toUpperCase());
      await page.getByLabel(t('ui.clients.fields.legalNameAr')).fill('اسم آخر');
      await page.getByRole('button', { name: t('ui.clients.create') }).click();
      await expect(
        page.getByRole('alert').filter({ hasText: t('ui.clients.duplicateTitle') }),
      ).toBeVisible();
      await expectAccessible(page, 'duplicate warning');

      // --- Phase 4: contracts — template, Manager drafts, Owner approves, signed, active, print ----
      await page.getByRole('link', { name: t('ui.shell.contracts') }).click();
      await expect(page.getByText(t('ui.contracts.empty'))).toBeVisible();
      await expectAccessible(page, 'contracts (empty)');
      await page.getByRole('link', { name: t('ui.contracts.templates') }).click();
      await page.getByRole('button', { name: t('ui.contracts.newTemplate') }).click();
      const tplDialog = page.getByRole('dialog');
      await tplDialog.getByLabel(t('ui.contracts.templateName')).fill('Annual audit');
      await tplDialog
        .getByLabel(t('ui.contracts.textEn'))
        .fill('Engagement letter for {{client.name}}, ref {{document.number}}.');
      await tplDialog
        .getByLabel(t('ui.contracts.textAr'))
        .fill('خطاب تكليف إلى {{client.name}}، المرجع {{document.number}}.');
      await expectAccessible(page, 'template dialog');
      await tplDialog.getByRole('button', { name: t('ui.contracts.save') }).click();
      await expect(page.getByText('Annual audit')).toBeVisible();

      // The colleague becomes a Manager (they prepare documents; the Owner approves).
      await page.getByRole('link', { name: t('ui.shell.members') }).click();
      await page
        .getByRole('row', { name: new RegExp(invitee.email) })
        .getByRole('button', { name: t('ui.members.changeRoles') })
        .click();
      const rolesDialog = page.getByRole('dialog');
      await rolesDialog.getByRole('checkbox', { name: t('roles.employee') }).click();
      await rolesDialog.getByRole('checkbox', { name: t('roles.manager') }).click();
      await rolesDialog.getByRole('button', { name: t('ui.members.saveRoles') }).click();
      // The lasting result, not the short-lived toast: the member's row now shows Manager.
      await expect(
        page.getByRole('row', { name: new RegExp(invitee.email) }).getByText(t('roles.manager')),
      ).toBeVisible();

      await guest.reload();
      await guest.getByRole('link', { name: t('ui.shell.contracts') }).click();
      await guest.getByRole('link', { name: t('ui.contracts.new') }).click();
      await guest.getByLabel(t('ui.contracts.fields.client')).click();
      await guest.getByRole('option', { name: new RegExp(clientName) }).click();
      await guest.getByLabel(t('ui.contracts.fields.template')).click();
      await guest.getByRole('option', { name: 'Annual audit' }).click();
      await guest.getByLabel(t('ui.contracts.fields.titleEn')).fill('Audit FY2026');
      await guest.getByLabel(t('ui.contracts.fields.titleAr')).fill('تدقيق السنة المالية 2026');
      await guest.getByLabel(t('ui.contracts.fields.valueAmount')).fill('12500.500');
      await expectAccessible(guest, 'new contract');
      await guest.getByRole('button', { name: t('ui.contracts.create') }).click();
      const letterTitle = locale === 'ar' ? 'تدقيق السنة المالية 2026' : 'Audit FY2026';
      await expect(guest.getByRole('heading', { name: letterTitle })).toBeVisible();
      await expect(
        guest.getByText(`Engagement letter for ${clientEn}, ref EL-0001.`),
      ).toBeAttached();
      await expectAccessible(guest, 'contract (draft)');
      await guest.getByRole('button', { name: t('ui.contracts.actions.submit') }).click();
      await expect(guest.getByText(t('ui.contracts.done.submit'), { exact: true })).toBeVisible();

      // The Owner is notified, approves, records sending, the signed copy, and activates.
      await page.goto(`http://${slug}.localhost:5173/contracts`);
      await page.getByRole('link', { name: letterTitle }).click();
      await page.getByRole('button', { name: t('ui.contracts.actions.approve') }).click();
      await expect(page.getByText(t('ui.contracts.done.approve'), { exact: true })).toBeVisible();
      await page.getByRole('button', { name: t('ui.contracts.actions.send') }).click();
      await expect(page.getByText(t('ui.contracts.done.send'), { exact: true })).toBeVisible();
      await page.getByRole('button', { name: t('ui.contracts.actions.sign') }).click();
      const signDialog = page.getByRole('dialog');
      await signDialog.locator('input[type="file"]').setInputFiles({
        name: 'signed-letter.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
      });
      await expectAccessible(page, 'record signed copy');
      await signDialog.getByRole('button', { name: t('ui.contracts.actions.sign') }).click();
      await expect(page.getByText(t('ui.contracts.done.sign'), { exact: true })).toBeVisible();
      await page.getByRole('button', { name: t('ui.contracts.actions.activate') }).click();
      await expect(page.getByText(t('ui.contracts.status.active'), { exact: true })).toBeVisible();
      await expectAccessible(page, 'contract (active)');

      const printPage = await page.context().newPage();
      await printPage.goto(page.url().replace(/\/?$/, '/print'));
      await expect(
        printPage.getByText(`خطاب تكليف إلى ${clientAr}، المرجع EL-0001.`),
      ).toBeVisible();
      await expectAccessible(printPage, 'print view');
      await printPage.close();

      // --- Phase 5: the Manager opens a project on that letter, budgets it and starts it -------
      await guest.getByRole('link', { name: t('ui.shell.projects') }).click();
      await expect(guest.getByText(t('ui.projects.empty'))).toBeVisible();
      await expectAccessible(guest, 'projects (empty)');
      await guest.getByRole('link', { name: t('ui.projects.new') }).click();
      await guest.getByLabel(t('ui.projects.fields.client')).click();
      await guest.getByRole('option', { name: new RegExp(clientName) }).click();
      await guest.getByLabel(t('ui.projects.fields.contract')).click();
      await guest.getByRole('option', { name: /EL-0001/ }).click();
      await guest.getByLabel(t('ui.projects.fields.manager')).click();
      await guest.getByRole('option', { name: invitee.name }).click();
      await guest.getByLabel(t('ui.projects.fields.nameEn')).fill('Statutory audit 2026');
      await guest.getByLabel(t('ui.projects.fields.nameAr')).fill('التدقيق القانوني 2026');
      await guest.getByLabel(t('ui.projects.fields.budgetHours')).fill('120');
      await guest.getByRole('checkbox', { name: owner.name }).click();
      await expectAccessible(guest, 'new project');
      await guest.getByRole('button', { name: t('ui.projects.create') }).click();
      const projectName = locale === 'ar' ? 'التدقيق القانوني 2026' : 'Statutory audit 2026';
      await expect(guest.getByRole('heading', { name: projectName })).toBeVisible();
      await expectAccessible(guest, 'project (planned)');

      await guest.getByRole('tab', { name: t('ui.projects.tabs.budget') }).click();
      await guest.getByRole('button', { name: t('ui.projects.revise') }).click();
      const budgetDialog = guest.getByRole('dialog');
      await budgetDialog.getByLabel(t('ui.projects.fields.budgetHours')).fill('150.5');
      await budgetDialog.getByLabel(t('ui.projects.reason')).fill('Inventory count added');
      await expectAccessible(guest, 'revise budget');
      await budgetDialog.getByRole('button', { name: t('ui.projects.saveRevision') }).click();
      await expect(guest.getByText('Inventory count added')).toBeVisible();
      await guest.getByRole('button', { name: t('ui.projects.moveTo.active') }).click();
      await expect(
        guest.getByRole('button', { name: t('ui.projects.moveTo.on_hold') }),
      ).toBeVisible();
      await expectAccessible(guest, 'project (active)');

      // The Owner, on the team, sees it on the dashboard and in the client's Projects tab.
      await page.goto(`http://${slug}.localhost:5173/`);
      await expect(
        page
          .getByRole('region', { name: t('ui.dashboard.keyNumbers') })
          .getByText(t('ui.dashboard.activeProjects'), { exact: true }),
      ).toBeVisible();
      await page.goto(`http://${slug}.localhost:5173/projects`);
      await expect(page.getByRole('link', { name: projectName })).toBeVisible();
      await expectAccessible(page, 'projects list');

      // --- Phase 6: the Manager plans a task with hours for two people; the Owner starts it ----
      await guest.getByRole('tab', { name: t('ui.projects.tabs.tasks') }).click();
      await expect(guest.getByText(t('ui.tasks.empty'))).toBeVisible();
      await guest.getByRole('link', { name: t('ui.tasks.newForProject') }).click();
      await expect(guest.getByText(/150[.,٫]5/).first()).toBeVisible();
      await guest.getByLabel(t('ui.tasks.fields.title')).fill('Inventory count');
      await guest.getByRole('checkbox', { name: invitee.name }).click();
      await guest.getByLabel(t('ui.tasks.hoursFor', { name: invitee.name })).fill('20');
      await guest.getByRole('checkbox', { name: owner.name }).click();
      await guest.getByLabel(t('ui.tasks.hoursFor', { name: owner.name })).fill('15');
      // The effect on the budget is shown before saving: 150.5 − 35 = 115.5 remaining.
      await expect(guest.getByRole('status').filter({ hasText: /115[.,٫]5/ })).toBeVisible();
      await expectAccessible(guest, 'new task');
      await guest.getByRole('button', { name: t('ui.tasks.create') }).click();
      await expect(guest.getByRole('heading', { name: 'Inventory count' })).toBeVisible();
      await expectAccessible(guest, 'task');

      await page.goto(`http://${slug}.localhost:5173/tasks`);
      await page.getByRole('link', { name: 'Inventory count' }).click();
      await page.getByRole('button', { name: t('ui.tasks.moveTo.in_progress') }).click();
      await expect(
        page.getByRole('button', { name: t('ui.tasks.moveTo.in_review') }),
      ).toBeVisible();
      await page.getByLabel(t('ui.tasks.addComment')).fill('Started with warehouse 1');
      await page.getByRole('button', { name: t('ui.tasks.postComment') }).click();
      await expect(page.getByText('Started with warehouse 1')).toBeVisible();
      await expectAccessible(page, 'task (in progress)');
      await page.goto(`http://${slug}.localhost:5173/tasks`);
      await page.getByRole('tab', { name: t('ui.tasks.viewBoard') }).click();
      await expect(
        page
          .getByRole('region', { name: t('ui.tasks.status.in_progress') })
          .getByText('Inventory count'),
      ).toBeVisible();
      await expectAccessible(page, 'task board');

      // --- Phase 7: the Owner logs 3.5 h on the task and submits; the Manager approves ----------
      await page.getByRole('link', { name: t('ui.shell.time') }).click();
      await expect(page.getByText(t('ui.time.noEntries'))).toBeVisible();
      await expectAccessible(page, 'my time (empty)');
      const logCard = page.locator('form').filter({ hasText: t('ui.time.add') });
      await logCard.getByLabel(t('ui.time.task')).click();
      await page.getByRole('option', { name: /Inventory count/ }).click();
      await logCard.getByLabel(t('ui.time.hours')).fill('3.5');
      await logCard.getByLabel(t('ui.time.description')).fill('Warehouse 1');
      await logCard.getByRole('button', { name: t('ui.time.add') }).click();
      await expect(page.getByText(/Warehouse 1/)).toBeVisible();
      await expectAccessible(page, 'my time (draft)');
      await page.getByRole('button', { name: t('ui.time.submitWeek') }).click();
      await expect(page.getByText(t('ui.time.status.submitted')).first()).toBeVisible();

      await guest.goto(`http://${slug}.localhost:5173/time/approvals`);
      await guest.getByRole('checkbox', { name: t('ui.time.selectAll') }).click();
      await expectAccessible(guest, 'time approvals');
      await guest.getByRole('button', { name: t('ui.time.approveSelected', { count: 1 }) }).click();
      await expect(guest.getByText(t('ui.time.nothingToApprove'))).toBeVisible();
      await page.reload();
      await expect(page.getByText(t('ui.time.status.approved')).first()).toBeVisible();

      // --- Phase 8: the Owner records the colleague as an employee and builds a team -------------
      await page.getByRole('link', { name: t('ui.shell.people') }).click();
      await expect(page.getByText(t('ui.people.empty'))).toBeVisible();
      await expectAccessible(page, 'people (empty)');
      await page.getByRole('button', { name: t('ui.people.new') }).click();
      const newPerson = page.getByRole('dialog');
      await newPerson.getByLabel(t('ui.people.member')).click();
      await page.getByRole('option', { name: new RegExp(invitee.name) }).click();
      await newPerson.getByLabel(t('ui.people.jobTitleEn')).fill('Audit manager');
      await newPerson.getByLabel(t('ui.people.jobTitleAr')).fill('مدير تدقيق');
      await expectAccessible(page, 'new employee');
      await newPerson.getByRole('button', { name: t('ui.people.create') }).click();
      await expect(page.getByRole('heading', { name: invitee.name })).toBeVisible();
      await expect(page.getByText('E-0001', { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: t('ui.people.tabs.private') }).click();
      await expect(page.getByText(t('ui.people.privateHint'))).toBeVisible();
      await expectAccessible(page, 'employee (private)');

      await page.goto(`http://${slug}.localhost:5173/organisation`);
      await page.getByLabel(t('ui.people.nameEn'), { exact: true }).fill('Audit');
      await page.getByLabel(t('ui.people.nameAr'), { exact: true }).fill('التدقيق');
      await page.getByRole('button', { name: t('ui.people.addDepartment') }).click();
      await page.getByLabel(t('ui.people.teamNameEn')).fill('Audit team A');
      await page.getByLabel(t('ui.people.teamNameAr')).fill('فريق التدقيق أ');
      await page.getByRole('button', { name: t('ui.people.addTeam') }).click();
      await page.getByRole('button', { name: t('ui.common.edit') }).click();
      const teamDialog = page.getByRole('dialog');
      await teamDialog.getByLabel(t('ui.people.teamLead')).click();
      await page.getByRole('option', { name: invitee.name }).click();
      await teamDialog.getByRole('checkbox', { name: invitee.name }).click();
      await teamDialog.getByRole('button', { name: t('ui.common.save') }).click();
      await expect(page.getByRole('link', { name: invitee.name })).toBeVisible();
      await expectAccessible(page, 'organisation');

      // --- Phase 9: the colleague applies for leave; the Owner approves; the calendar shows it -----
      const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000);
      inTwoWeeks.setUTCDate(inTwoWeeks.getUTCDate() - inTwoWeeks.getUTCDay()); // a Sunday
      const leaveStart = inTwoWeeks.toISOString().slice(0, 10);
      const leaveEnd = new Date(inTwoWeeks.getTime() + 86_400_000).toISOString().slice(0, 10);
      await guest.reload();
      await guest.getByRole('link', { name: t('ui.shell.leave') }).click();
      await expect(guest.getByText(t('ui.leave.noRequests'))).toBeVisible();
      await expectAccessible(guest, 'my leave');
      await guest.getByLabel(t('ui.leave.type')).click();
      await guest
        .getByRole('option', { name: locale === 'ar' ? 'إجازة بدون راتب' : 'Unpaid leave' })
        .click();
      await guest.getByLabel(t('ui.leave.from')).fill(leaveStart);
      await guest.getByLabel(t('ui.leave.to')).fill(leaveEnd);
      await expect(
        guest.getByRole('status').filter({ hasText: t('ui.leave.previewDays', { days: '2' }) }),
      ).toBeVisible();
      await guest.getByRole('button', { name: t('ui.leave.submit') }).click();
      await expect(guest.getByText(t('ui.leave.status.pending')).first()).toBeVisible();

      await page.goto(`http://${slug}.localhost:5173/leave`);
      await page.getByRole('tab', { name: t('ui.leave.tabs.approvals') }).click();
      await expectAccessible(page, 'leave approvals');
      await page.getByRole('button', { name: t('ui.leave.actions.approve') }).click();
      await expect(page.getByText(t('ui.leave.nothingWaiting'))).toBeVisible();
      await page.getByRole('tab', { name: t('ui.leave.tabs.calendar') }).click();
      await expect(page.getByText(invitee.name).first()).toBeVisible();
      await expectAccessible(page, 'leave calendar');
      await page.getByRole('tab', { name: t('ui.leave.tabs.policies') }).click();
      await expect(page.getByText(t('ui.leave.verifyNote'))).toBeVisible();
      await expectAccessible(page, 'leave policies');

      // --- Phase 10: the Owner sets up a kiosk; the colleague scans its code and is checked in ---
      await page.getByRole('link', { name: t('ui.shell.attendance') }).click();
      await page.getByRole('tab', { name: t('ui.attendance.tabs.setup') }).click();
      await page.getByLabel(t('ui.attendance.siteNameEn')).fill('Head office');
      await page.getByLabel(t('ui.attendance.siteNameAr')).fill('المكتب الرئيسي');
      await page.getByRole('button', { name: t('ui.attendance.addSite') }).click();
      const kioskLink = page.getByRole('link', { name: t('ui.attendance.openKiosk') });
      await expect(kioskLink).toBeVisible();
      await expectAccessible(page, 'attendance setup');
      const kioskPath = (await kioskLink.getAttribute('href')) ?? '';
      const kiosk = await page.context().newPage();
      await kiosk.goto(`http://${slug}.localhost:5173${kioskPath}`);
      await expect(kiosk.getByRole('img', { name: t('ui.attendance.qrLabel') })).toBeVisible();
      await expectAccessible(kiosk, 'attendance kiosk');
      // What the phone camera would read from the QR: the scan link with the current code.
      const siteId = kioskPath.split('/').pop() ?? '';
      const code = await kiosk.evaluate(async (id) => {
        const res = await fetch(`/api/v1/attendance/sites/${id}/code`, { credentials: 'include' });
        return ((await res.json()) as { code: string }).code;
      }, siteId);
      await kiosk.close();

      await guest.goto(
        `http://${slug}.localhost:5173/attendance/scan?code=${encodeURIComponent(code)}`,
      );
      await expectAccessible(guest, 'attendance scan');
      await guest.getByRole('button', { name: t('ui.attendance.confirmScan') }).click();
      await expect(guest.getByRole('status').filter({ hasText: /\d/ })).toBeVisible();
      await guest.getByRole('link', { name: t('ui.attendance.myAttendance') }).click();
      await expect(guest.getByText(t('ui.attendance.method.qr'), { exact: false })).toBeVisible();
      await expectAccessible(guest, 'my attendance');

      await page.reload();
      await page.getByRole('tab', { name: t('ui.attendance.tabs.today') }).click();
      await expect(
        page
          .getByRole('listitem')
          .filter({ hasText: invitee.name })
          .getByText(t('ui.attendance.state.in'), { exact: true }),
      ).toBeVisible();
      await expectAccessible(page, 'attendance today');

      // --- Phase 11: the Owner (also CEO) records a salary and prepares a test payroll run -------
      await page.getByRole('link', { name: t('ui.shell.payroll') }).click();
      await expect(page.getByText(t('ui.payroll.notVerified'))).toBeVisible();
      await expectAccessible(page, 'payroll');
      await page.getByRole('tab', { name: t('ui.payroll.tabs.salaries') }).click();
      await page.getByLabel(t('ui.payroll.person')).click();
      await page.getByRole('option', { name: invitee.name }).click();
      await page.getByLabel(t('ui.payroll.effectiveFrom')).fill('2026-01-01');
      await page.getByLabel(t('ui.payroll.basic')).fill('1000');
      await page.getByLabel(t('ui.payroll.housing')).fill('150');
      await page.getByRole('button', { name: t('ui.payroll.saveSalary') }).click();
      await expect(page.getByText(invitee.name).last()).toBeVisible();
      await page.getByRole('tab', { name: t('ui.payroll.tabs.rules') }).click();
      await expect(page.getByText(t('ui.payroll.toVerify')).first()).toBeVisible();
      await expectAccessible(page, 'payroll rules');
      await page.getByRole('tab', { name: t('ui.payroll.tabs.runs') }).click();
      await page.getByRole('button', { name: t('ui.payroll.newRun') }).click();
      await page.getByRole('button', { name: t('ui.payroll.actions.calculate') }).click();
      await expect(page.getByText(t('ui.payroll.testRun'))).toBeVisible();
      await page
        .getByRole('button', { name: t('ui.payroll.showLines') })
        .first()
        .click();
      await expectAccessible(page, 'payroll run');
      await page.getByRole('button', { name: t('ui.payroll.actions.submit') }).click();
      await expect(page.getByText(t('ui.payroll.status.submitted'))).toBeVisible();
      // The preparer is never offered approval of their own run.
      await expect(page.getByRole('button', { name: t('ui.payroll.actions.approve') })).toHaveCount(
        0,
      );

      await guest.goto(`http://${slug}.localhost:5173/payroll/payslips`);
      await expect(guest.getByText(t('ui.payroll.noPayslips'))).toBeVisible();
      await expectAccessible(guest, 'my payslips');

      // --- Phase 12: the Owner invoices the approved time, issues it and records a payment -------
      await page.getByRole('link', { name: t('ui.shell.invoices') }).click();
      await expect(page.getByText(t('ui.billing.empty'))).toBeVisible();
      await expectAccessible(page, 'invoices (empty)');
      await page.getByRole('link', { name: t('ui.billing.new') }).click();
      await page.getByLabel(t('ui.billing.client')).click();
      await page.getByRole('option', { name: new RegExp(clientName) }).click();
      await page.getByLabel(t('ui.billing.project')).click();
      await page.getByRole('option', { name: /P-0001/ }).click();
      await page.getByLabel(t('ui.billing.hourlyRate')).fill('20');
      await expectAccessible(page, 'new invoice');
      await page.getByRole('button', { name: t('ui.billing.draftFromTime') }).click();
      await expect(page.getByRole('heading', { name: t('ui.billing.draftLabel') })).toBeVisible();
      await page.getByRole('button', { name: t('ui.billing.issue') }).click();
      await expect(page.getByRole('heading', { name: 'INV-0001' })).toBeVisible();
      await page.getByRole('button', { name: t('ui.billing.recordPayment') }).click();
      const payDialog = page.getByRole('dialog');
      await payDialog.getByLabel(t('ui.billing.amount')).fill('50');
      await expectAccessible(page, 'record payment');
      await payDialog.getByRole('button', { name: t('ui.billing.dialog.pay') }).click();
      await expect(page.getByText(t('ui.billing.statusName.partially_paid')).first()).toBeVisible();
      await expectAccessible(page, 'invoice (partly paid)');
      const invoicePrint = await page.context().newPage();
      await invoicePrint.goto(page.url().replace(/\/?$/, '/print'));
      await expect(invoicePrint.getByText('INV-0001').first()).toBeVisible();
      await expectAccessible(invoicePrint, 'invoice print');
      await invoicePrint.close();

      // --- Phase 12b: the colleague claims an expense; the Owner approves and reimburses it -------
      await guest.goto(`http://${slug}.localhost:5173/expenses`);
      await expect(guest.getByText(t('ui.expenses.empty'))).toBeVisible();
      await expectAccessible(guest, 'expenses (empty)');
      await guest.getByRole('button', { name: t('ui.expenses.new') }).click();
      await expect(guest.getByLabel(t('ui.expenses.claimTitle'))).toBeVisible();
      await guest.getByLabel(t('ui.expenses.claimTitle')).fill('Client visit');
      await guest.getByLabel(t('ui.expenses.line.category')).click();
      await guest
        .getByRole('option', { name: locale === 'ar' ? 'مواصلات' : 'Local transport' })
        .click();
      await guest.getByLabel(t('ui.expenses.line.description')).fill('Taxi to the warehouse');
      await guest.getByLabel(t('ui.expenses.line.amount')).fill('3.500');
      await expectAccessible(guest, 'expense claim (draft)');
      await guest.getByRole('button', { name: t('ui.expenses.submit') }).click();
      await expect(guest.getByRole('heading', { name: 'EX-0001 · Client visit' })).toBeVisible();
      await expect(
        guest.getByText(t('ui.expenses.statusName.submitted'), { exact: true }),
      ).toBeVisible();

      await page.goto(`http://${slug}.localhost:5173/expenses`);
      await page.getByRole('tab', { name: t('ui.expenses.tabs.approvals') }).click();
      await expectAccessible(page, 'expense approvals');
      await page.getByRole('link', { name: 'EX-0001' }).click();
      await page.getByRole('button', { name: t('ui.expenses.approve') }).click();
      await expect(
        page.getByText(t('ui.expenses.statusName.approved'), { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: t('ui.expenses.reimburse') }).click();
      const reimburseDialog = page.getByRole('dialog');
      await reimburseDialog.getByLabel(t('ui.expenses.reference')).fill('TRX-1');
      await expectAccessible(page, 'record reimbursement');
      await reimburseDialog
        .getByRole('button', { name: t('ui.expenses.dialog.reimburse') })
        .click();
      await expect(
        page.getByText(t('ui.expenses.statusName.reimbursed'), { exact: true }),
      ).toBeVisible();
      await expectAccessible(page, 'expense claim (reimbursed)');

      // --- Phase 14: the Owner runs the clients report and searches the audit log -------------
      await page.goto(`http://${slug}.localhost:5173/reports`);
      await expect(
        page.getByRole('heading', { name: t('ui.reports.groups.finance') }),
      ).toBeVisible();
      await expectAccessible(page, 'reports');
      await page.getByRole('link', { name: new RegExp(t('ui.reports.summaries.clients')) }).click();
      await expect(page.getByText(t('ui.reports.definitions.clients'))).toBeVisible();
      // The client invoiced in Phase 12 appears with its name in the reader's language.
      await expect(page.getByRole('cell', { name: clientName })).toBeVisible();
      await expectAccessible(page, 'clients report');
      await expect(page.getByRole('link', { name: t('ui.reports.exportCsv') })).toHaveAttribute(
        'href',
        /\/api\/v1\/reports\/clients\/export\.csv\?/,
      );
      await page.goto(`http://${slug}.localhost:5173/audit`);
      await page.getByLabel(t('ui.audit.area')).click();
      await page.getByRole('option', { name: t('ui.audit.areas.billing') }).click();
      await expect(page.getByText('billing.invoice.issued')).toBeVisible();
      await expectAccessible(page, 'audit log');

      // --- Phase 13: the Owner publishes an announcement; the colleague reads it ----------------
      await page.getByRole('link', { name: t('ui.shell.announcements') }).click();
      await expect(page.getByText(t('ui.announcements.empty'))).toBeVisible();
      await page.getByLabel(t('ui.announcements.titleEn')).fill('Office closed Thursday');
      await page.getByLabel(t('ui.announcements.titleAr')).fill('المكتب مغلق يوم الخميس');
      await page.getByLabel(t('ui.announcements.bodyEn')).fill('For National Day.');
      await page.getByLabel(t('ui.announcements.bodyAr')).fill('بمناسبة العيد الوطني.');
      await page.getByRole('button', { name: t('ui.announcements.checkRecipients') }).click();
      await expect(page.getByText(t('ui.announcements.willReach', { count: 2 }))).toBeVisible();
      await expectAccessible(page, 'new announcement');
      await page.getByRole('button', { name: t('ui.announcements.publish', { count: 2 }) }).click();
      await expect(
        page.getByRole('heading', {
          name: locale === 'ar' ? 'المكتب مغلق يوم الخميس' : 'Office closed Thursday',
        }),
      ).toBeVisible();

      await guest.goto(`http://${slug}.localhost:5173/announcements`);
      await expect(
        guest.getByRole('heading', {
          name: locale === 'ar' ? 'المكتب مغلق يوم الخميس' : 'Office closed Thursday',
        }),
      ).toBeVisible();
      await expectAccessible(guest, 'announcements');
      await page.getByRole('link', { name: t('ui.shell.myAccount') }).click();
      await expect(page.getByText(t('ui.notifications.preferencesTitle'))).toBeVisible();
      await page
        .getByRole('checkbox', {
          name: `${t('ui.notifications.colEmail')}: ${t('ui.notifications.typeLabel.tasks_assigned')}`,
        })
        .click();
      await expect(page.getByText(t('ui.notifications.saved'), { exact: true })).toBeVisible();

      // The dashboard of a firm that has been working: what needs attention, numbers, revenue.
      await page.goto(`http://${slug}.localhost:5173/`);
      await expect(
        page.getByRole('heading', { name: t('ui.dashboard.attention.title') }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(t('ui.dashboard.revenueTitle', { year: String(new Date().getFullYear()) })),
      ).toBeVisible();
      await expectAccessible(page, 'dashboard (working firm)');
      await page.screenshot({
        path: `e2e/screenshots/dashboard-busy-${locale}.png`,
        fullPage: true,
        animations: 'disabled',
      });

      // --- Owner changes their password from My account --------------------------------------
      await page.goto(`http://${slug}.localhost:5173/account`);
      await expectAccessible(page, 'my account');
      await page.getByLabel(t('ui.account.currentPassword')).fill(owner.password);
      await page
        .getByLabel(t('ui.account.newPassword'), { exact: true })
        .fill(`${owner.password} v2`);
      await page.getByRole('button', { name: t('ui.account.changePassword') }).click();
      // The leaked-password check calls an outside service (up to 3 s) before hashing.
      await expect(page.getByText(t('ui.account.passwordChanged'), { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await deleteEmailsTo(owner.email, invitee.email);
    }
  });
}
