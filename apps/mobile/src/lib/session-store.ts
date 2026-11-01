import { type KeyValueStore } from './storage';

/** The company the person is working in, with the auth state for its own host. */
export interface CompanySession {
  tenantId: string;
  slug: string;
  name: { en: string; ar: string };
  origin: string;
  state: string;
}

/** Everything the app remembers between launches (kept in the secure store). */
export interface Sessions {
  /** Main address of the installation (sign-in, companies list). */
  server: string;
  /** Auth state for the main address ('' when signed out). */
  mainState: string;
  company: CompanySession | null;
}

const KEY = 'erp.sessions';

export function emptySessions(server: string): Sessions {
  return { server, mainState: '', company: null };
}

function isSessions(value: unknown): value is Sessions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.server !== 'string' || typeof v.mainState !== 'string') return false;
  const company: unknown = v.company;
  if (company === null) return true;
  if (typeof company !== 'object') return false;
  const c = company as Record<string, unknown>;
  return (
    typeof c.tenantId === 'string' &&
    typeof c.slug === 'string' &&
    typeof c.origin === 'string' &&
    typeof c.state === 'string' &&
    typeof c.name === 'object' &&
    c.name !== null
  );
}

/** Reads the saved sessions; anything unreadable counts as signed out. */
export async function readSessions(store: KeyValueStore, defaultServer: string): Promise<Sessions> {
  const raw = await store.get(KEY);
  if (raw === null) return emptySessions(defaultServer);
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSessions(parsed) ? parsed : emptySessions(defaultServer);
  } catch {
    return emptySessions(defaultServer);
  }
}

export function writeSessions(store: KeyValueStore, sessions: Sessions): Promise<void> {
  return store.set(KEY, JSON.stringify(sessions));
}

export function clearSessions(store: KeyValueStore): Promise<void> {
  return store.delete(KEY);
}
