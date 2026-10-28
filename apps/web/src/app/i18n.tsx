import {
  DIRECTION,
  type Locale,
  type MessageKey,
  type MessageParams,
  translate,
} from '@ultimate-erp/i18n';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { readPreference, writePreference } from './preferences.js';

interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, params?: MessageParams) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18n | null>(null);

const browserLocale = (): Locale =>
  navigator.languages.some((l) => l.toLowerCase().startsWith('ar')) ? 'ar' : 'en';

/**
 * Language rules (owner decision 2026-10-28): a choice made on this browser wins; otherwise the
 * company's default language on a company address, else the browser's language.
 * (After sign-in, the account's saved language takes over — Milestone 1.4b.)
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const saved = readPreference('locale');
  const [locale, setLocaleState] = useState<Locale>(
    saved === 'ar' || saved === 'en' ? saved : browserLocale(),
  );

  useEffect(() => {
    if (saved === 'ar' || saved === 'en') return;
    // On a company address, its default language applies. Fails quietly on the main address.
    const controller = new AbortController();
    fetch('/api/v1/tenant', { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ defaultLocale?: Locale }>) : null))
      .then((tenant) => {
        if (tenant?.defaultLocale) setLocaleState(tenant.defaultLocale);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [saved]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = DIRECTION[locale];
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writePreference('locale', next);
    setLocaleState(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      dir: DIRECTION[locale],
      t: (key, params) => translate(locale, key, params),
      setLocale,
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
