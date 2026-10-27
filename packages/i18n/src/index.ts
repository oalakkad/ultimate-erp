import { ar } from './catalogs/ar.js';
import { en } from './catalogs/en.js';
import { type Catalog, type Locale } from './types.js';

export * from './types.js';

export const catalogs: Record<Locale, Catalog> = { en, ar };

/**
 * Replaces `{name}` placeholders. Unknown placeholders are left visible rather than silently
 * dropped, so a missing parameter is noticed in review.
 */
export function format(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match);
}
