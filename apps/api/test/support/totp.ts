import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';

const PERIOD_SECONDS = 30;

/**
 * The 6-digit code an authenticator app shows for `totpUri`, `offset` time steps from now
 * (0 = now, 1 = the next 30-second step). Servers accept codes one step either side.
 */
export async function codeAt(totpUri: string, offset: number): Promise<string> {
  const secret = new URL(totpUri).searchParams.get('secret');
  if (!secret) throw new Error('totpUri has no secret');
  const step = Math.floor(Date.now() / 1000 / PERIOD_SECONDS) + offset;
  return createOTP(base32.decode(secret)).hotp(step);
}
