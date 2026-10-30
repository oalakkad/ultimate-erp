import { useQuery } from '@tanstack/react-query';
import {
  accessMeResponseSchema,
  meResponseSchema,
  myCompaniesResponseSchema,
  tenantPublicProfileSchema,
} from '@ultimate-erp/contracts';
import { api, isApiError } from './api.js';

/**
 * The company owning this address (`acme.localhost`), or null on the main address.
 * Decided by the server from the host — the app never chooses a company itself.
 */
export function useTenant() {
  return useQuery({
    queryKey: ['tenant'],
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return await api('/tenant', { schema: tenantPublicProfileSchema });
      } catch (err) {
        if (isApiError(err, 'NOT_FOUND')) return null;
        throw err;
      }
    },
  });
}

/** The signed-in user on this address, or null. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api('/auth/me', { schema: meResponseSchema });
      } catch (err) {
        if (isApiError(err, 'UNAUTHENTICATED')) return null;
        throw err;
      }
    },
  });
}

/** My roles and permissions in this company; null if I am not a member. */
export function useAccess(enabled: boolean) {
  return useQuery({
    queryKey: ['access'],
    enabled,
    queryFn: async () => {
      try {
        return await api('/access/me', { schema: accessMeResponseSchema });
      } catch (err) {
        if (isApiError(err, 'NOT_FOUND') || isApiError(err, 'UNAUTHENTICATED')) return null;
        throw err;
      }
    },
  });
}

export function useMyCompanies(enabled: boolean) {
  return useQuery({
    queryKey: ['companies'],
    enabled,
    queryFn: () => api('/auth/companies', { schema: myCompaniesResponseSchema }),
  });
}

/** True if this person holds `permission` (UX only — the server enforces every action). */
export function can(
  access: { permissions: Record<string, string[]> } | null | undefined,
  permission: string,
): boolean {
  return (access?.permissions[permission] ?? []).includes('company');
}

/** True if this person holds `permission` at any scope, e.g. only on their own projects (UX only). */
export function canAny(
  access: { permissions: Record<string, string[]> } | null | undefined,
  permission: string,
): boolean {
  return (access?.permissions[permission] ?? []).length > 0;
}
