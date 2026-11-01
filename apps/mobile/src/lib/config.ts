import Constants from 'expo-constants';

/**
 * Default main address of the installation. `EXPO_PUBLIC_API_URL` at build time wins (for a
 * company's own build); otherwise `expo.extra.apiUrl` from app.json; the sign-in screen lets the
 * person change it (on-premises installations have their own addresses).
 */
export function defaultServerUrl(): string {
  const fromEnv = (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_URL;
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
  const extra = Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined;
  return typeof extra?.apiUrl === 'string' ? extra.apiUrl : 'http://localhost:5173';
}

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';
