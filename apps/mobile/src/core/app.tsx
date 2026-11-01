import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale } from '@ultimate-erp/i18n';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { deviceStore } from '../lib/device-storage';
import { defaultServerUrl } from '../lib/config';
import { isApiError } from '../lib/api';
import { I18nProvider, readSavedLocale } from './i18n';
import { Navigation } from './navigation';
import { SessionProvider } from './session';

/** Providers: secure store → language → data cache → session → screens. */
export function App() {
  const store = useMemo(() => deviceStore(), []);
  const [savedLocale, setSavedLocale] = useState<Locale | null | undefined>(undefined);
  const [accountLocale, setAccountLocale] = useState<Locale | null>(null);

  useEffect(() => {
    void readSavedLocale(store).then(setSavedLocale);
  }, [store]);

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: (count, error) => !isApiError(error) && count < 2,
          },
        },
      }),
    [],
  );
  const onUserLocale = useCallback((locale: Locale) => {
    setAccountLocale(locale);
  }, []);

  if (savedLocale === undefined) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider store={store} initialLocale={savedLocale} accountLocale={accountLocale}>
          <SessionProvider
            store={store}
            defaultServer={defaultServerUrl()}
            onUserLocale={onUserLocale}
          >
            <StatusBar style="auto" />
            <Navigation />
          </SessionProvider>
        </I18nProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
