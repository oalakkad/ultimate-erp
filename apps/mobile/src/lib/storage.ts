/**
 * Where the app keeps its small secrets (auth state per host) and preferences. On a phone this is
 * the secure store (iOS Keychain / Android Keystore); in a browser (development preview) it is
 * localStorage. Everything that uses it is written against this interface so the logic can be
 * tested without a device.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-memory store for tests and as a fallback when no persistent store exists. */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(initial));
  return {
    get: (key) => Promise.resolve(map.get(key) ?? null),
    set: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}
