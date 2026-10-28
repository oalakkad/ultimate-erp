/**
 * Extra rule for completing a sign-in, implemented by the access module (which knows about
 * companies and memberships). Identity only defines the hook, so it never depends on access.
 */
export interface SignInPolicy {
  /** False to refuse a sign-in on this host (the new session is then discarded). */
  allows(hostname: string, user: { id: string; email: string }): Promise<boolean>;
}

export const SIGN_IN_POLICY = Symbol('SIGN_IN_POLICY');
