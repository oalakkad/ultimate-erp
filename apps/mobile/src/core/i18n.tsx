import {
  DIRECTION,
  type Locale,
  type MessageKey,
  type MessageParams,
  translate,
} from '@ultimate-erp/i18n';
import { getLocales } from 'expo-localization';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { I18nManager, Platform } from 'react-native';
import { type KeyValueStore } from '../lib/storage';

interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, params?: MessageParams) => string;
  setLocale: (locale: Locale) => void;
  /** True when the layout direction only changes after the app is reopened (native). */
  restartNeeded: boolean;
}

const I18nContext = createContext<I18n | null>(null);
const LOCALE_KEY = 'erp.locale';

const deviceLocale = (): Locale =>
  getLocales().some((l) => l.languageCode?.toLowerCase() === 'ar') ? 'ar' : 'en';

/**
 * Language: a choice made in the app wins; else the account's saved language (after sign-in);
 * else the device language. Same rule as the web.
 */
export function I18nProvider({
  store,
  initialLocale,
  accountLocale,
  children,
}: {
  store: KeyValueStore;
  /** The language chosen in this app earlier, if any. */
  initialLocale: Locale | null;
  /** The signed-in account's saved language (applies only without a choice made here). */
  accountLocale: Locale | null;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<Locale | null>(initialLocale);
  const [device] = useState(deviceLocale);
  const locale = chosen ?? accountLocale ?? device;
  const rtl = DIRECTION[locale] === 'rtl';
  // Native layout direction is fixed per launch; a mismatch means "reopen the app".
  const restartNeeded = Platform.OS !== 'web' && I18nManager.isRTL !== rtl;

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined') {
        document.documentElement.lang = locale;
        document.documentElement.dir = DIRECTION[locale];
      }
      return;
    }
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
  }, [locale, rtl]);

  const setLocale = useCallback(
    (next: Locale) => {
      void store.set(LOCALE_KEY, next);
      setChosen(next);
    },
    [store],
  );

  const value = useMemo<I18n>(
    () => ({
      locale,
      dir: DIRECTION[locale],
      t: (key, params) => translate(locale, key, params),
      setLocale,
      restartNeeded,
    }),
    [locale, setLocale, restartNeeded],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export async function readSavedLocale(store: KeyValueStore): Promise<Locale | null> {
  const saved = await store.get(LOCALE_KEY);
  return saved === 'ar' || saved === 'en' ? saved : null;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

/** Bilingual names from the API in the reader's language. */
export function useName() {
  const { locale } = useI18n();
  return (name: { en: string; ar: string }) => (locale === 'ar' ? name.ar : name.en);
}
