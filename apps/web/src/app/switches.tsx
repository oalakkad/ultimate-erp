import { useQueryClient } from '@tanstack/react-query';
import { userSchema } from '@ultimate-erp/contracts';
import { type Locale } from '@ultimate-erp/i18n';
import { SegmentedControl } from '@ultimate-erp/ui';
import { api } from '../lib/api.js';
import { useI18n } from './i18n.js';
import { type Theme, useTheme } from './theme.js';

export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n();
  const queryClient = useQueryClient();
  const change = (next: Locale) => {
    setLocale(next);
    // Signed in: remember the choice on the account too (emails use it). Best effort — the
    // screen has already switched and the browser keeps the choice either way.
    if (queryClient.getQueryData(['me'])) {
      void api('/auth/me', { method: 'PATCH', body: { locale: next }, schema: userSchema }).catch(
        () => undefined,
      );
    }
  };
  return (
    <SegmentedControl<Locale>
      label={t('ui.common.language')}
      value={locale}
      onChange={change}
      options={[
        { value: 'en', label: t('ui.common.english'), lang: 'en' },
        { value: 'ar', label: t('ui.common.arabic'), lang: 'ar' },
      ]}
    />
  );
}

export function ThemeSwitch() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl<Theme>
      label={t('ui.common.theme')}
      value={theme}
      onChange={setTheme}
      options={[
        { value: 'system', label: t('ui.common.themeSystem') },
        { value: 'light', label: t('ui.common.themeLight') },
        { value: 'dark', label: t('ui.common.themeDark') },
      ]}
    />
  );
}
