import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  isRole,
  isSensitive,
  type Role,
  type Session,
  type SignInResponse,
  type User,
} from '@ultimate-erp/contracts';
import {
  type Database,
  sessions,
  usedTotpCodes,
  userKnownDevices,
  users,
  verifications,
} from '@ultimate-erp/db';
import { and, desc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import { type Request, type Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DB } from '../../platform/database/database.tokens.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { type RateLimitRule, RateLimiter } from '../../platform/rate-limit/rate-limiter.js';
import { clientIp } from '../../platform/request-context/client-ip.js';
import { AUTH, type Auth, CLIENT_IP_HEADER, SESSION_ABSOLUTE_SECONDS } from './auth.js';
import { authErrorCode, callAuth, toAppError } from './auth-errors.js';
import { BreachedPasswordChecker } from './breached-password.js';
import { IdentityEmails } from './identity-emails.js';
import { SIGN_IN_POLICY, type SignInPolicy } from './sign-in-policy.js';

/** Limits per docs/modules/identity.md §2. Subjects are hashed before storage. */
export const RATE_LIMITS = {
  signInIp: { name: 'sign-in:ip', limit: 30, windowSeconds: 5 * 60 },
  signInAccountFailures: { name: 'sign-in:account-failures', limit: 5, windowSeconds: 15 * 60 },
  signUpIp: { name: 'sign-up:ip', limit: 10, windowSeconds: 60 * 60 },
  emailRequestIp: { name: 'email-request:ip', limit: 10, windowSeconds: 60 * 60 },
  emailRequestAddress: { name: 'email-request:address', limit: 3, windowSeconds: 60 * 60 },
  tokenIp: { name: 'token:ip', limit: 30, windowSeconds: 5 * 60 },
  twoFactorIp: { name: 'two-factor:ip', limit: 20, windowSeconds: 5 * 60 },
  sensitiveUser: { name: 'sensitive:user', limit: 10, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

/** A TOTP code is valid for at most ~90 s (30 s step ± 1); keep used codes a bit longer. */
const USED_CODE_RETENTION_SECONDS = 5 * 60;

/** Better Auth two-factor plugin cookie (with our `erp` prefix; `__Secure-` added on https). */
const TRUST_DEVICE_COOKIE = 'erp.trust_device';

interface AuthSession {
  id: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The signed-in user and session attached to a request by SessionGuard. */
export interface Identity {
  userId: string;
  session: AuthSession;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Copies Set-Cookie headers produced by Better Auth onto our response. */
function forwardCookies(res: Response, headers: Headers): void {
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) res.append('Set-Cookie', cookies);
}

const sessionDto = (session: AuthSession, currentId: string): Session => ({
  id: session.id,
  createdAt: session.createdAt.toISOString(),
  lastActiveAt: session.updatedAt.toISOString(),
  expiresAt: session.expiresAt.toISOString(),
  ipAddress: session.ipAddress ?? null,
  userAgent: session.userAgent ?? null,
  current: session.id === currentId,
});

/**
 * Identity use-cases. Wraps Better Auth so every operation also gets rate limits, breach
 * checks, replay protection, notices and our error codes. Controllers stay thin.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Database,
    private readonly limiter: RateLimiter,
    private readonly breached: BreachedPasswordChecker,
    private readonly emails: IdentityEmails,
    @InjectPinoLogger(IdentityService.name) private readonly logger: PinoLogger,
    @Optional() @Inject(SIGN_IN_POLICY) private readonly signInPolicy?: SignInPolicy,
  ) {}

  // --- sign-up and email verification ------------------------------------------------------

  async signUp(
    req: Request,
    body: { email: string; password: string; name: string; locale: 'en' | 'ar' },
  ): Promise<void> {
    await this.limiter.consume(RATE_LIMITS.signUpIp, clientIp(req));
    await this.assertPasswordNotBreached(body.password);
    // With email verification required, Better Auth answers identically for existing emails
    // and calls onExistingUserSignUp, so the response cannot reveal who has an account.
    await callAuth(() => this.auth.api.signUpEmail({ body, headers: this.headersFor(req) }));
  }

  async verifyEmail(req: Request, token: string): Promise<void> {
    await this.limiter.consume(RATE_LIMITS.tokenIp, clientIp(req));
    await callAuth(() => this.auth.api.verifyEmail({ query: { token } }));
  }

  async resendVerification(req: Request, email: string): Promise<void> {
    await this.limitEmailRequest(req, email);
    try {
      await this.auth.api.sendVerificationEmail({ body: { email } });
    } catch (err) {
      // Unknown or already-verified addresses must look exactly like success.
      if (!authErrorCode(err)) throw err;
    }
  }

  // --- sign-in -----------------------------------------------------------------------------

  async signIn(
    req: Request,
    res: Response,
    body: { email: string; password: string; rememberMe: boolean },
  ): Promise<SignInResponse> {
    await this.limiter.consume(RATE_LIMITS.signInIp, clientIp(req));
    // Locked accounts are refused before the password is even checked.
    await this.limiter.assertNotLimited(RATE_LIMITS.signInAccountFailures, body.email);

    let result;
    try {
      result = await this.auth.api.signInEmail({
        body,
        headers: this.headersFor(req),
        returnHeaders: true,
      });
    } catch (err) {
      if (authErrorCode(err) === 'INVALID_EMAIL_OR_PASSWORD') {
        await this.recordFailedSignIn(body.email);
      }
      throw toAppError(err);
    }
    await this.limiter.reset(RATE_LIMITS.signInAccountFailures, body.email);

    const response = result.response as {
      twoFactorRedirect?: boolean;
      token?: string;
      user?: { id: string };
    };
    if (response.twoFactorRedirect) {
      forwardCookies(res, result.headers);
      return { status: 'two_factor_required' };
    }
    if (!response.user || !response.token) throw new Error('Sign-in succeeded without a session');
    return this.completeSignIn(req, res, {
      userId: response.user.id,
      sessionToken: response.token,
      headers: result.headers,
      trustRequested: false,
    });
  }

  /** Second sign-in step with an authenticator code. Each code works only once per user. */
  async verifyTotp(
    req: Request,
    res: Response,
    body: { code: string; trustDevice: boolean },
  ): Promise<SignInResponse> {
    await this.limiter.consume(RATE_LIMITS.twoFactorIp, clientIp(req));
    const result = await callAuth(() =>
      this.auth.api.verifyTOTP({ body, headers: this.headersFor(req), returnHeaders: true }),
    );
    const { token, user } = result.response as { token: string; user: { id: string } };
    if (!(await this.markCodeUsed(user.id, body.code))) {
      // Replay: the code was valid but already used. Discard the session just created and
      // do not hand its cookies to the caller.
      await this.db.delete(sessions).where(eq(sessions.token, token));
      throw new AppError('INVALID_CODE', HttpStatus.UNAUTHORIZED, messageFor('INVALID_CODE'));
    }
    return this.completeSignIn(req, res, {
      userId: user.id,
      sessionToken: token,
      headers: result.headers,
      trustRequested: body.trustDevice,
    });
  }

  /** Second sign-in step with a backup code (Better Auth makes each backup code single-use). */
  async verifyBackupCode(
    req: Request,
    res: Response,
    body: { code: string; trustDevice: boolean },
  ): Promise<SignInResponse> {
    await this.limiter.consume(RATE_LIMITS.twoFactorIp, clientIp(req));
    const result = await callAuth(() =>
      this.auth.api.verifyBackupCode({ body, headers: this.headersFor(req), returnHeaders: true }),
    );
    const { token, user } = result.response as { token: string; user: { id: string } };
    return this.completeSignIn(req, res, {
      userId: user.id,
      sessionToken: token,
      headers: result.headers,
      trustRequested: body.trustDevice,
    });
  }

  /**
   * Final step of every successful sign-in: the company-host policy (members and invitees
   * only), no trusted devices for sensitive roles, cookies, and the new-device notice.
   */
  private async completeSignIn(
    req: Request,
    res: Response,
    done: { userId: string; sessionToken: string; headers: Headers; trustRequested: boolean },
  ): Promise<SignInResponse> {
    const [account] = await this.userSummaries([done.userId]);
    if (
      this.signInPolicy &&
      !(await this.signInPolicy.allows(req.hostname, {
        id: done.userId,
        email: account?.email ?? '',
      }))
    ) {
      await this.db.delete(sessions).where(eq(sessions.token, done.sessionToken));
      throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, messageFor('FORBIDDEN'));
    }
    let cookies = done.headers.getSetCookie();
    if (done.trustRequested && (await this.holdsSensitiveRole(done.userId))) {
      // Sensitive roles must always enter a code: drop the trust cookie Better Auth just set.
      cookies = cookies.filter((cookie) => !cookie.split('=')[0]?.endsWith(TRUST_DEVICE_COOKIE));
    }
    if (cookies.length > 0) res.append('Set-Cookie', cookies);
    await this.noteDevice(done.userId, req);
    return { status: 'signed_in', user: await this.userDto(done.userId) };
  }

  /** Whether the user holds a role needing two-factor in any company. */
  async holdsSensitiveRole(userId: string): Promise<boolean> {
    const result = await this.db.execute<{ role: string }>(
      sql`select app.user_role_names(${userId}) as role`,
    );
    const roles = result.rows.map((r) => r.role).filter((r): r is Role => isRole(r));
    return isSensitive(roles);
  }

  /**
   * Cancels every "trust this device" grant of a user (called when they gain a sensitive role).
   * Better Auth stores trust grants with hashed identifiers and the user ID as value, so all of
   * the user's pending verification values go — this also voids an unused password-reset link,
   * which is acceptable at a privilege change.
   */
  async revokeTrustedDevices(userId: string): Promise<void> {
    await this.db.delete(verifications).where(eq(verifications.value, userId));
  }

  /** The account ID for an email address (case-insensitive), or null. */
  async userIdByEmail(email: string): Promise<string | null> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    return user?.id ?? null;
  }

  /** Name, email and two-factor status for display in company member lists. */
  async userSummaries(userIds: readonly string[]) {
    if (userIds.length === 0) return [];
    return this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        twoFactorEnabled: users.twoFactorEnabled,
        locale: users.locale,
      })
      .from(users)
      .where(inArray(users.id, [...userIds]));
  }

  // --- sessions ----------------------------------------------------------------------------

  /**
   * The session behind this request's cookie, or null. Enforces the 12-hour absolute lifetime
   * on top of Better Auth's 30-minute sliding idle timeout.
   */
  async resolveSession(req: Request, res: Response): Promise<Identity | null> {
    const result = await callAuth(() =>
      this.auth.api.getSession({ headers: this.headersFor(req), returnHeaders: true }),
    );
    forwardCookies(res, result.headers);
    const found = result.response as { session: AuthSession; user: { id: string } } | null;
    if (!found) return null;
    const ageSeconds = (Date.now() - new Date(found.session.createdAt).getTime()) / 1000;
    if (ageSeconds > SESSION_ABSOLUTE_SECONDS) {
      await this.db.delete(sessions).where(eq(sessions.id, found.session.id));
      return null;
    }
    return {
      userId: found.user.id,
      session: {
        ...found.session,
        createdAt: new Date(found.session.createdAt),
        updatedAt: new Date(found.session.updatedAt),
        expiresAt: new Date(found.session.expiresAt),
      },
    };
  }

  async me(identity: Identity): Promise<{ user: User; session: Session }> {
    return {
      user: await this.userDto(identity.userId),
      session: sessionDto(identity.session, identity.session.id),
    };
  }

  async signOut(req: Request, res: Response): Promise<void> {
    const result = await callAuth(() =>
      this.auth.api.signOut({ headers: this.headersFor(req), returnHeaders: true }),
    );
    forwardCookies(res, result.headers);
  }

  /** The user's active sessions. Session tokens are never returned. */
  async listSessions(identity: Identity): Promise<Session[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, identity.userId), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.createdAt));
    return rows.map((row) => sessionDto(row, identity.session.id));
  }

  async revokeSession(identity: Identity, sessionId: string): Promise<void> {
    const deleted = await this.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, identity.userId)))
      .returning({ id: sessions.id });
    // Another user's session ID looks exactly like a missing one.
    if (deleted.length === 0) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
    }
  }

  async revokeOtherSessions(identity: Identity): Promise<void> {
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, identity.userId), ne(sessions.id, identity.session.id)));
  }

  // --- passwords ---------------------------------------------------------------------------

  async forgotPassword(req: Request, email: string): Promise<void> {
    await this.limitEmailRequest(req, email);
    try {
      await this.auth.api.requestPasswordReset({ body: { email } });
    } catch (err) {
      if (!authErrorCode(err)) throw err; // unknown address: answer as if sent
    }
  }

  /** Whether a reset link is still usable (does not consume it). */
  async checkResetToken(req: Request, token: string): Promise<void> {
    await this.limiter.consume(RATE_LIMITS.tokenIp, clientIp(req));
    const context = await this.auth.$context;
    const verification = await context.internalAdapter.findVerificationValue(
      `reset-password:${token}`,
    );
    if (!verification || new Date(verification.expiresAt) < new Date()) {
      throw new AppError('INVALID_TOKEN', HttpStatus.BAD_REQUEST, messageFor('INVALID_TOKEN'));
    }
  }

  /** Sets a new password from a reset link; Better Auth then revokes all sessions. */
  async resetPassword(req: Request, body: { token: string; newPassword: string }): Promise<void> {
    await this.limiter.consume(RATE_LIMITS.tokenIp, clientIp(req));
    await this.assertPasswordNotBreached(body.newPassword);
    await callAuth(() => this.auth.api.resetPassword({ body }));
  }

  async changePassword(
    req: Request,
    res: Response,
    identity: Identity,
    body: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    await this.limiter.consume(RATE_LIMITS.sensitiveUser, identity.userId);
    await this.assertPasswordNotBreached(body.newPassword);
    const result = await callAuth(() =>
      this.auth.api.changePassword({
        body: { ...body, revokeOtherSessions: true },
        headers: this.headersFor(req),
        returnHeaders: true,
      }),
    );
    forwardCookies(res, result.headers);
    await this.notify(identity.userId, (user) => this.emails.passwordChanged(user));
  }

  // --- two-factor management ---------------------------------------------------------------

  /** Starts setup: returns the authenticator URI and backup codes. Inactive until confirmed. */
  async enableTwoFactor(req: Request, identity: Identity, password: string) {
    await this.limiter.consume(RATE_LIMITS.sensitiveUser, identity.userId);
    const result = await callAuth(() =>
      this.auth.api.enableTwoFactor({ body: { password }, headers: this.headersFor(req) }),
    );
    if (!('totpURI' in result)) throw new Error('Two-factor setup returned no authenticator URI');
    return { totpUri: result.totpURI, backupCodes: result.backupCodes };
  }

  /** Activates two-factor with the first code from the authenticator app. */
  async confirmTwoFactor(req: Request, res: Response, identity: Identity, code: string) {
    await this.limiter.consume(RATE_LIMITS.sensitiveUser, identity.userId);
    if (!(await this.markCodeUsed(identity.userId, code))) {
      throw new AppError('INVALID_CODE', HttpStatus.UNAUTHORIZED, messageFor('INVALID_CODE'));
    }
    const result = await callAuth(() =>
      this.auth.api.verifyTOTP({
        body: { code },
        headers: this.headersFor(req),
        returnHeaders: true,
      }),
    );
    forwardCookies(res, result.headers);
    await this.notify(identity.userId, (user) => this.emails.twoFactorEnabled(user));
  }

  async disableTwoFactor(req: Request, res: Response, identity: Identity, password: string) {
    await this.limiter.consume(RATE_LIMITS.sensitiveUser, identity.userId);
    const result = await callAuth(() =>
      this.auth.api.disableTwoFactor({
        body: { password },
        headers: this.headersFor(req),
        returnHeaders: true,
      }),
    );
    forwardCookies(res, result.headers);
    await this.notify(identity.userId, (user) => this.emails.twoFactorDisabled(user));
  }

  async regenerateBackupCodes(req: Request, identity: Identity, password: string) {
    await this.limiter.consume(RATE_LIMITS.sensitiveUser, identity.userId);
    const result = await callAuth(() =>
      this.auth.api.generateBackupCodes({ body: { password }, headers: this.headersFor(req) }),
    );
    return { backupCodes: result.backupCodes };
  }

  // --- helpers -----------------------------------------------------------------------------

  /** Headers for Better Auth: the cookie, user agent and our own trusted client IP. */
  private headersFor(req: Request): Headers {
    const headers = new Headers();
    if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
    const userAgent = req.headers['user-agent'];
    if (userAgent) headers.set('user-agent', userAgent);
    headers.set(CLIENT_IP_HEADER, clientIp(req));
    return headers;
  }

  private async assertPasswordNotBreached(password: string): Promise<void> {
    if (await this.breached.isBreached(password)) {
      throw new AppError(
        'PASSWORD_COMPROMISED',
        HttpStatus.UNPROCESSABLE_ENTITY,
        messageFor('PASSWORD_COMPROMISED'),
      );
    }
  }

  private async limitEmailRequest(req: Request, email: string): Promise<void> {
    await this.limiter.consume(RATE_LIMITS.emailRequestIp, clientIp(req));
    await this.limiter.consume(RATE_LIMITS.emailRequestAddress, email);
  }

  /** Counts a failed sign-in; on reaching the limit, emails the account owner (once). */
  private async recordFailedSignIn(email: string): Promise<void> {
    const { count } = await this.limiter.hit(RATE_LIMITS.signInAccountFailures, email);
    if (count !== RATE_LIMITS.signInAccountFailures.limit) return;
    const [user] = await this.db
      .select({ email: users.email, name: users.name, locale: users.locale })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`);
    if (user) await this.safely('account-locked notice', () => this.emails.accountLocked(user));
  }

  /** Records an accepted TOTP code; false if this user already used it (replay). */
  private async markCodeUsed(userId: string, code: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - USED_CODE_RETENTION_SECONDS * 1000);
    await this.db.delete(usedTotpCodes).where(lt(usedTotpCodes.usedAt, cutoff));
    const inserted = await this.db
      .insert(usedTotpCodes)
      .values({ userId, codeHash: sha256(`${userId}:${code}`) })
      .onConflictDoNothing()
      .returning({ userId: usedTotpCodes.userId });
    return inserted.length > 0;
  }

  /** Emails the user when they sign in from a browser not seen before (not on the first). */
  private async noteDevice(userId: string, req: Request): Promise<void> {
    const userAgent = req.headers['user-agent'] ?? 'unknown';
    const [row] = await this.db
      .insert(userKnownDevices)
      .values({ userId, deviceHash: sha256(userAgent) })
      .onConflictDoUpdate({
        target: [userKnownDevices.userId, userKnownDevices.deviceHash],
        set: { lastSeenAt: new Date() },
      })
      .returning({ isNew: sql<boolean>`xmax = 0` });
    if (!row?.isNew) return;
    const [{ total } = { total: 0 }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(userKnownDevices)
      .where(eq(userKnownDevices.userId, userId));
    if (total <= 1) return;
    await this.notify(userId, (user) =>
      this.emails.newDevice(user, {
        device: userAgent.slice(0, 200),
        ip: clientIp(req),
        time: new Date().toISOString(),
      }),
    );
  }

  private async userDto(userId: string): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user)
      throw new AppError('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, messageFor('UNAUTHENTICATED'));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      locale: user.locale,
    };
  }

  /** Sends a security notice to a user; a failed notice is logged, not fatal to the action. */
  private async notify(
    userId: string,
    send: (user: { email: string; name: string; locale: string }) => Promise<void>,
  ): Promise<void> {
    const [user] = await this.db
      .select({ email: users.email, name: users.name, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    if (user) await this.safely('security notice', () => send(user));
  }

  private async safely(what: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error({ err }, `Failed to send ${what}`);
    }
  }
}
