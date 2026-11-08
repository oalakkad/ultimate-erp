import { useQueryClient } from '@tanstack/react-query';
import { userSchema } from '@ultimate-erp/contracts';
import { type Locale } from '@ultimate-erp/i18n';
import { IconButton, SegmentedControl } from '@ultimate-erp/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from './i18n.js';
import { type Theme, useTheme } from './theme.js';

/** Switches the language; when signed in, also saves it on the account (emails use it). */
export function useChangeLocale() {
  const { setLocale } = useI18n();
  const queryClient = useQueryClient();
  return (next: Locale) => {
    setLocale(next);
    // Signed in: remember the choice on the account too (emails use it). Best effort — the
    // screen has already switched and the browser keeps the choice either way.
    if (queryClient.getQueryData(['me'])) {
      void api('/auth/me', { method: 'PATCH', body: { locale: next }, schema: userSchema }).catch(
        () => undefined,
      );
    }
  };
}

export function LanguageSwitch() {
  const { t, locale } = useI18n();
  const change = useChangeLocale();
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

/** One button that switches to the other language, labelled in that language. */
export function LanguageToggle() {
  const { t, locale } = useI18n();
  const change = useChangeLocale();
  const next = locale === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      lang={next}
      title={t('ui.common.language')}
      onClick={() => {
        change(next);
      }}
      className="ui-glass h-11 rounded-full px-4 text-[13px] font-bold text-ink-2 transition-colors hover:text-ink"
    >
      {next === 'ar' ? t('ui.common.arabic') : t('ui.common.english')}
    </button>
  );
}

const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL = {
  system: 'ui.common.themeSystem',
  light: 'ui.common.themeLight',
  dark: 'ui.common.themeDark',
} as const;

/** Cycles System → Light → Dark; the icon and name show the current choice. */
export function ThemeToggle() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const Icon = THEME_ICON[theme];
  return (
    <IconButton
      label={`${t('ui.common.theme')}: ${t(THEME_LABEL[theme])}`}
      onClick={() => {
        setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'system');
      }}
    >
      <Icon aria-hidden />
    </IconButton>
  );
}
