import {
  accessMeResponseSchema,
  handoffResponseSchema,
  meResponseSchema,
  type MyCompany,
  myCompaniesResponseSchema,
  type SignInResponse,
  signInResponseSchema,
  type User,
} from '@ultimate-erp/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { type ApiClient, createApiClient, isApiError } from '../lib/api';
import { type CompanySession, emptySessions } from '../lib/session-store';
import { SessionsState } from '../lib/sessions-state';
import { type KeyValueStore } from '../lib/storage';

export type Access = { roles: string[]; permissions: Record<string, string[]> };

export type SessionStatus =
  | 'loading'
  | 'signed_out'
  /** Signed in on the main address, password accepted, code still needed. */
  | 'two_factor'
  /** Signed in, no company chosen (or the chosen one no longer accepts us). */
  | 'choose_company'
  | 'ready';

interface SessionContextValue {
  status: SessionStatus;
  server: string;
  user: User | null;
  company: CompanySession | null;
  access: Access | null;
  /** Calls to the main address (sign-in, companies, hand-off). */
  mainApi: ApiClient;
  /** Calls to the chosen company's address; rejects when no company is chosen. */
  api: ApiClient;
  setServer: (server: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInResponse>;
  verifyTwoFactor: (
    code: string,
    kind: 'totp' | 'backup',
    trustDevice: boolean,
  ) => Promise<SignInResponse>;
  listCompanies: () => Promise<MyCompany[]>;
  openCompany: (company: MyCompany) => Promise<void>;
  leaveCompany: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** True if this person holds `permission` at any scope (UX only — the server enforces). */
export function canAny(access: Access | null, permission: string): boolean {
  return (access?.permissions[permission] ?? []).length > 0;
}

/** A client for the main address, reading and writing the main auth state in `state`. */
function mainClient(state: SessionsState, server: string): ApiClient {
  return createApiClient({
    origin: server,
    getState: () => state.get().mainState,
    setState: (next) => state.update((s) => ({ ...s, mainState: next })),
  });
}

/** A client for the chosen company, keeping that company's auth state in `state`. */
function companyClient(state: SessionsState, origin: string): ApiClient {
  return createApiClient({
    origin,
    getState: () => state.get().company?.state ?? '',
    setState: (next) =>
      state.update((s) => (s.company ? { ...s, company: { ...s.company, state: next } } : s)),
  });
}

const noCompany: ApiClient = () => Promise.reject(new Error('No company chosen'));

/** Ends a session on a host; failures are ignored (the state is dropped locally anyway). */
const goodbye = (origin: string, auth: string) =>
  createApiClient({ origin, getState: () => auth, setState: () => undefined })('/auth/sign-out', {
    method: 'POST',
  }).catch(() => undefined);

/** Loads my roles and permissions in the company (throws the API's error otherwise). */
async function fetchAccess(client: ApiClient): Promise<Access> {
  const me = await client('/access/me', { schema: accessMeResponseSchema });
  return { roles: me.roles, permissions: me.permissions };
}

/** Errors that mean "this company does not accept this session": drop it, choose again. */
const refused = (err: unknown) =>
  isApiError(err, 'UNAUTHENTICATED') ||
  isApiError(err, 'NOT_FOUND') ||
  isApiError(err, 'FORBIDDEN') ||
  isApiError(err, 'MFA_REQUIRED');

export function SessionProvider({
  store,
  defaultServer,
  onUserLocale,
  children,
}: {
  store: KeyValueStore;
  defaultServer: string;
  /** Lets the i18n provider apply the account's saved language. */
  onUserLocale: (locale: User['locale']) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const state = useMemo(() => new SessionsState(store, defaultServer), [store, defaultServer]);
  const sessions = useSyncExternalStore(state.subscribe, state.get);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<Access | null>(null);

  const mainApi = useMemo(() => mainClient(state, sessions.server), [state, sessions.server]);
  const companyOrigin = sessions.company?.origin;
  const api = useMemo(
    () => (companyOrigin === undefined ? noCompany : companyClient(state, companyOrigin)),
    [state, companyOrigin],
  );

  // Start-up: restore what the secure store holds and check it with the server.
  useEffect(() => {
    const run = { cancelled: false };
    // A function, so TypeScript does not narrow the flag across the awaits below.
    const cancelled = () => run.cancelled;
    void (async () => {
      const saved = await state.restore(defaultServer);
      if (saved.mainState === '') {
        if (!cancelled()) setStatus('signed_out');
        return;
      }
      try {
        const me = await mainClient(state, saved.server)('/auth/me', { schema: meResponseSchema });
        if (cancelled()) return;
        setUser(me.user);
        onUserLocale(me.user.locale);
      } catch (err) {
        if (cancelled()) return;
        if (isApiError(err, 'UNAUTHENTICATED')) {
          await state.set({ ...saved, mainState: '', company: null });
          setStatus('signed_out');
          return;
        }
        // Offline or server down: keep what we have; screens show the connection error.
        setStatus(saved.company ? 'ready' : 'choose_company');
        return;
      }
      const company = state.get().company;
      if (company) {
        let found: Access | null | 'unreachable';
        try {
          found = await fetchAccess(companyClient(state, company.origin));
        } catch (err) {
          found = refused(err) ? null : 'unreachable';
        }
        if (cancelled()) return;
        if (found !== null) {
          // Accepted (or unreachable: keep going, screens will show the error).
          if (found !== 'unreachable') setAccess(found);
          setStatus('ready');
          return;
        }
        await state.update((s) => ({ ...s, company: null }));
      }
      if (!cancelled()) setStatus('choose_company');
    })();
    return () => {
      run.cancelled = true;
    };
  }, [state, defaultServer, onUserLocale]);

  const setServer = useCallback(
    async (server: string) => {
      await state.set(emptySessions(server));
      setUser(null);
      setAccess(null);
      setStatus('signed_out');
    },
    [state],
  );

  const finishSignIn = useCallback(
    (result: SignInResponse) => {
      if (result.status === 'signed_in') {
        setUser(result.user);
        onUserLocale(result.user.locale);
        setStatus('choose_company');
      } else {
        setStatus('two_factor');
      }
      return result;
    },
    [onUserLocale],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      // A fresh sign-in starts from an empty jar on the main address.
      await state.update((s) => ({ ...s, mainState: '', company: null }));
      const result = await mainClient(state, state.get().server)('/auth/sign-in', {
        method: 'POST',
        body: { email, password, rememberMe: true },
        schema: signInResponseSchema,
      });
      return finishSignIn(result);
    },
    [state, finishSignIn],
  );

  const verifyTwoFactor = useCallback(
    async (code: string, kind: 'totp' | 'backup', trustDevice: boolean) => {
      const result = await mainClient(state, state.get().server)(
        kind === 'totp' ? '/auth/two-factor/verify' : '/auth/two-factor/verify-backup-code',
        { method: 'POST', body: { code, trustDevice }, schema: signInResponseSchema },
      );
      return finishSignIn(result);
    },
    [state, finishSignIn],
  );

  const listCompanies = useCallback(async () => {
    const { companies } = await mainClient(state, state.get().server)('/auth/companies', {
      schema: myCompaniesResponseSchema,
    });
    return companies;
  }, [state]);

  const openCompany = useCallback(
    async (company: MyCompany) => {
      const { url } = await mainClient(state, state.get().server)('/auth/handoff', {
        method: 'POST',
        body: { tenantId: company.tenantId },
        schema: handoffResponseSchema,
      });
      const ticket = new URL(url).searchParams.get('ticket');
      if (!ticket) throw new Error('Hand-off without a ticket');
      const origin = new URL(url).origin;
      let fresh = '';
      await createApiClient({
        origin,
        getState: () => fresh,
        setState: (next) => {
          fresh = next;
        },
      })('/auth/handoff/redeem', {
        method: 'POST',
        body: { ticket },
        schema: signInResponseSchema,
      });
      // Only a company that accepts us is remembered (an Owner without two-factor, for
      // example, is told to set it up on the web first).
      let found: Access;
      try {
        found = await fetchAccess(
          createApiClient({ origin, getState: () => fresh, setState: () => undefined }),
        );
      } catch (err) {
        await goodbye(origin, fresh);
        throw err;
      }
      const chosen: CompanySession = {
        tenantId: company.tenantId,
        slug: company.slug,
        name: company.name,
        origin,
        state: fresh,
      };
      await state.update((s) => ({ ...s, company: chosen }));
      queryClient.clear();
      setAccess(found);
      setStatus('ready');
    },
    [state, queryClient],
  );

  const leaveCompany = useCallback(async () => {
    const company = state.get().company;
    if (company) await goodbye(company.origin, company.state);
    await state.update((s) => ({ ...s, company: null }));
    setAccess(null);
    queryClient.clear();
    setStatus('choose_company');
  }, [state, queryClient]);

  const signOut = useCallback(async () => {
    const { server, mainState, company } = state.get();
    await Promise.all([
      company ? goodbye(company.origin, company.state) : Promise.resolve(),
      mainState ? goodbye(server, mainState) : Promise.resolve(),
    ]);
    await state.set(emptySessions(server));
    setUser(null);
    setAccess(null);
    queryClient.clear();
    setStatus('signed_out');
  }, [state, queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      server: sessions.server,
      user,
      company: sessions.company,
      access,
      mainApi,
      api,
      setServer,
      signIn,
      verifyTwoFactor,
      listCompanies,
      openCompany,
      leaveCompany,
      signOut,
    }),
    [
      status,
      sessions,
      user,
      access,
      mainApi,
      api,
      setServer,
      signIn,
      verifyTwoFactor,
      listCompanies,
      openCompany,
      leaveCompany,
      signOut,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** The company API for screens that are only shown when a company is chosen. */
export function useApi(): ApiClient {
  return useSession().api;
}
