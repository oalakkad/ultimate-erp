import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { readPreference, writePreference } from './preferences.js';

export type Theme = 'system' | 'light' | 'dark';

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

/** System by default; a forced light/dark choice is kept per browser (data-theme on <html>). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const saved = readPreference('theme');
  const [theme, setThemeState] = useState<Theme>(
    saved === 'light' || saved === 'dark' ? saved : 'system',
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    writePreference('theme', next);
    setThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
