import { emptySessions, readSessions, type Sessions, writeSessions } from './session-store';
import { type KeyValueStore } from './storage';

/**
 * The live copy of the saved sessions: API clients read the latest auth state from it between
 * renders, React reads it through `useSyncExternalStore`, and every change is written to the
 * secure store.
 */
export class SessionsState {
  private sessions: Sessions;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: KeyValueStore,
    defaultServer: string,
  ) {
    this.sessions = emptySessions(defaultServer);
  }

  readonly get = (): Sessions => this.sessions;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Loads what the secure store holds (once, at start-up). */
  async restore(defaultServer: string): Promise<Sessions> {
    const saved = await readSessions(this.store, defaultServer);
    this.publish(saved);
    return saved;
  }

  async set(next: Sessions): Promise<void> {
    this.publish(next);
    await writeSessions(this.store, next);
  }

  /** Updates from the current value (used by API clients storing a new auth state). */
  update(change: (current: Sessions) => Sessions): Promise<void> {
    return this.set(change(this.sessions));
  }

  private publish(next: Sessions): void {
    this.sessions = next;
    for (const listener of this.listeners) listener();
  }
}
