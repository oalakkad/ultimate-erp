import { describe, expect, it } from 'vitest';
import {
  clearSessions,
  emptySessions,
  readSessions,
  writeSessions,
} from '../src/lib/session-store';
import { memoryStore } from '../src/lib/storage';

describe('session store', () => {
  it('starts signed out at the default server', async () => {
    const store = memoryStore();
    expect(await readSessions(store, 'https://erp.example')).toEqual(
      emptySessions('https://erp.example'),
    );
  });

  it('round-trips the saved sessions', async () => {
    const store = memoryStore();
    const sessions = {
      server: 'https://erp.example',
      mainState: 'abc',
      company: {
        tenantId: '0193d1f0-0000-7000-8000-000000000000',
        slug: 'acme',
        name: { en: 'Acme', ar: 'أكمي' },
        origin: 'https://acme.erp.example',
        state: 'def',
      },
    };
    await writeSessions(store, sessions);
    expect(await readSessions(store, 'x')).toEqual(sessions);
    await clearSessions(store);
    expect(await readSessions(store, 'x')).toEqual(emptySessions('x'));
  });

  it('treats unreadable or foreign content as signed out', async () => {
    expect(await readSessions(memoryStore({ 'erp.sessions': 'not json' }), 'x')).toEqual(
      emptySessions('x'),
    );
    expect(
      await readSessions(memoryStore({ 'erp.sessions': JSON.stringify({ server: 1 }) }), 'x'),
    ).toEqual(emptySessions('x'));
  });
});
