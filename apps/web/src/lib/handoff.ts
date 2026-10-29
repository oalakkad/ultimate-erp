import { handoffResponseSchema } from '@ultimate-erp/contracts';
import { api } from './api.js';

/** Sends the browser to a company address with a one-time ticket (sign in once). */
export async function openCompany(tenantId: string) {
  const { url } = await api('/auth/handoff', {
    method: 'POST',
    body: { tenantId },
    schema: handoffResponseSchema,
  });
  window.location.assign(url);
}

/**
 * The main address (where "Your companies" lives): company addresses are <slug>.<main>, so drop
 * the first label. Custom company domains (later) will need the server to tell us instead.
 */
export function mainAppUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol}//${host.replace(/^[^.]+\./, '')}`;
}
