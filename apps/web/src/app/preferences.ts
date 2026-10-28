/**
 * Per-browser conveniences (language, theme). Storage can be unavailable (private windows,
 * blocked site data), so every access is guarded and the app works without it.
 */
const PREFIX = 'erp.';

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not stored; the choice still applies for this visit.
  }
}
