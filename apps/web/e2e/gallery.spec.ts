import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Milestone 1.4a acceptance criteria 1, 2, 4 (docs/modules/web-ui.md §5): the gallery in both
// languages and both themes, right-to-left in Arabic, no WCAG 2.2 A/AA violations.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

for (const locale of ['en', 'ar'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`gallery — ${locale} / ${theme}`, async ({ page }) => {
      await page.addInitScript(
        (prefs) => {
          localStorage.setItem('erp.locale', prefs.locale);
          localStorage.setItem('erp.theme', prefs.theme);
        },
        { locale, theme },
      );
      await page.goto('/gallery');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => document.fonts.ready);

      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);

      await page.screenshot({
        path: `e2e/screenshots/gallery-${locale}-${theme}.png`,
        fullPage: true,
      });
    });
  }
}

test('switching language flips the layout direction without a reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('erp.locale', 'en');
  });
  await page.goto('/gallery');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    page
      .getByRole('heading', { name: 'معرض المكونات' })
      .or(page.getByText('معرض المكونات'))
      .first(),
  ).toBeVisible();
  // The side drawer opens on the inline-end side: the left edge in Arabic.
  await page.getByRole('button', { name: 'افتح اللوحة الجانبية' }).click();
  const drawer = page.getByRole('dialog');
  const box = await drawer.boundingBox();
  expect(box && box.x).toBeLessThan(100);
});

test('the dialog traps focus and closes with Escape, returning focus to its trigger', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('erp.locale', 'en');
  });
  await page.goto('/gallery');
  const trigger = page.getByRole('button', { name: 'Open dialog' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Approve this timesheet?' });
  await expect(dialog).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(WCAG).include('[role="dialog"]').analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
