import {
  accounts,
  type Database,
  sessions,
  twoFactors,
  users,
  verifications,
} from '@ultimate-erp/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { type PinoLogger } from 'nestjs-pino';
import { type AppConfig } from '../../platform/config/config.js';
import { type IdentityEmails } from './identity-emails.js';

export const AUTH = Symbol('AUTH');

/** Header our code sets (never the client) so Better Auth records the real socket IP. */
export const CLIENT_IP_HEADER = 'x-erp-client-ip';

export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
export const TRUST_DEVICE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Better Auth configured for our rules (docs/modules/identity.md). Its own HTTP handler is
 * never mounted: our controllers call `auth.api.*` so every route gets our validation, error
 * format, rate limits and logging.
 */
export function createAuth(deps: {
  db: Database;
  config: AppConfig;
  emails: IdentityEmails;
  logger: PinoLogger;
}) {
  const { db, config, emails, logger } = deps;
  return betterAuth({
    appName: 'Ultimate ERP',
    baseURL: config.APP_PUBLIC_URL,
    basePath: '/api/v1/auth',
    secret: config.AUTH_SECRET,
    trustedOrigins: [config.APP_PUBLIC_URL, ...config.CORS_ORIGINS],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        twoFactor: twoFactors,
      },
    }),
    // No usage data leaves the installation (confidential data, on-prem customers).
    telemetry: { enabled: false },
    // Our RateLimiter (Postgres-backed) covers every route instead.
    rateLimit: { enabled: false },
    logger: {
      log: (level, message, ...args) => {
        logger[level]({ args }, `better-auth: ${message}`);
      },
    },
    advanced: {
      // IDs come from PostgreSQL's uuidv7() column default.
      database: { generateId: false },
      cookiePrefix: 'erp',
      useSecureCookies: config.APP_PUBLIC_URL.startsWith('https://'),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    // Reset and verification tokens are stored hashed: a database leak exposes no usable link.
    verification: { storeIdentifier: 'hashed' },
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'en', input: true },
      },
    },
    session: {
      // Sliding idle timeout: a session unused for 30 minutes expires. The 12-hour absolute
      // limit is enforced by IdentityService.resolveSession.
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: 5 * 60,
      cookieCache: { enabled: false },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, token }) => emails.resetPassword(user, token),
      onPasswordReset: ({ user }) => emails.passwordChanged(user),
      // Enumeration protection: sign-up answers the same; the real owner is told instead.
      onExistingUserSignUp: ({ user }) => emails.existingAccount(user),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: ({ user, token }) => emails.verifyEmail(user, token),
    },
    plugins: [
      twoFactor({
        issuer: 'Ultimate ERP',
        backupCodeOptions: { amount: 10 },
        trustDeviceMaxAge: TRUST_DEVICE_SECONDS,
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
