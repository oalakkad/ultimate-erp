import { z } from 'zod';
import { localeSchema } from './tenancy.js';

// Request and response shapes for /api/v1/auth (docs/modules/identity.md §4).
// Every request schema is strict: unknown fields are rejected, not ignored.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const email = z.email().max(254);
/** New passwords: length only, no composition rules (NIST SP 800-63B); breach check server-side. */
const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
/** Existing passwords are only bounded, never judged, so old accounts can still sign in. */
const currentPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const token = z.string().min(1).max(512);
const totpCode = z.string().regex(/^\d{6}$/, 'must be 6 digits');

export const signUpRequestSchema = z
  .object({
    email,
    password: newPassword,
    name: z.string().trim().min(1).max(100),
    locale: localeSchema.default('en'),
  })
  .strict();

export const emailOnlyRequestSchema = z.object({ email }).strict();

export const signInRequestSchema = z
  .object({ email, password: currentPassword, rememberMe: z.boolean().default(true) })
  .strict();

export const verifyEmailQuerySchema = z.object({ token }).strict();

export const twoFactorVerifyRequestSchema = z
  .object({ code: totpCode, trustDevice: z.boolean().default(false) })
  .strict();

export const backupCodeRequestSchema = z
  .object({ code: z.string().trim().min(1).max(64), trustDevice: z.boolean().default(false) })
  .strict();

export const twoFactorConfirmRequestSchema = z.object({ code: totpCode }).strict();

export const passwordConfirmRequestSchema = z.object({ password: currentPassword }).strict();

export const resetPasswordRequestSchema = z.object({ token, newPassword }).strict();

export const changePasswordRequestSchema = z.object({ currentPassword, newPassword }).strict();

export const sessionIdParamSchema = z.object({ id: z.uuid() }).strict();

/** Answer to sign-up / resend / forgot: deliberately identical whether or not the email exists. */
export const acceptedResponseSchema = z.object({ status: z.literal('accepted') }).strict();

export const userSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
    locale: localeSchema,
  })
  .strict();
export type User = z.infer<typeof userSchema>;

export const signInResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('signed_in'), user: userSchema }).strict(),
  z.object({ status: z.literal('two_factor_required') }).strict(),
]);
export type SignInResponse = z.infer<typeof signInResponseSchema>;

export const sessionSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    lastActiveAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    current: z.boolean(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;

export const meResponseSchema = z.object({ user: userSchema, session: sessionSchema }).strict();
export const sessionListResponseSchema = z.object({ sessions: z.array(sessionSchema) }).strict();

export const twoFactorSetupResponseSchema = z
  .object({ totpUri: z.string(), backupCodes: z.array(z.string()) })
  .strict();
export const backupCodesResponseSchema = z.object({ backupCodes: z.array(z.string()) }).strict();

export const okResponseSchema = z.object({ status: z.literal('ok') }).strict();
