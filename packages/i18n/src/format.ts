import { IntlMessageFormat } from 'intl-messageformat';
import { ar } from './catalogs/ar.js';
import { en } from './catalogs/en.js';
import { type Catalog, type Locale } from './types.js';

const catalogs: Record<Locale, Catalog> = { en, ar };

/** Every leaf key of the catalog as a dotted path, e.g. `ui.shell.dashboard`. */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<typeof en>;

export type MessageParams = Record<string, string | number>;

/**
 * BCP 47 tag used for formatting. Western digits (latn) in both languages by default
 * (ADR-0006), Kuwait regional conventions.
 */
export const formatLocale = (locale: Locale) => `${locale}-KW-u-nu-latn`;

const cache = new Map<string, IntlMessageFormat>();

function lookup(locale: Locale, key: string): string {
  let node: unknown = catalogs[locale];
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') throw new Error(`Missing message "${key}" (${locale})`);
  return node;
}

/** Formats a catalog message with ICU syntax (placeholders, plurals). */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const id = `${locale}:${key}`;
  let formatter = cache.get(id);
  if (!formatter) {
    formatter = new IntlMessageFormat(lookup(locale, key), formatLocale(locale));
    cache.set(id, formatter);
  }
  return String(formatter.format(params));
}

/**
 * Formats a money amount given as a decimal **string** (API money is never a float, ADR-0005)
 * with the currency's own decimals, e.g. "182460.25" KWD → "182,460.250 KWD" / "182,460.250 د.ك.".
 */
export function formatMoney(locale: Locale, amount: string, currency: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(amount)) throw new Error(`Not a decimal amount: ${amount}`);
  const format = new Intl.NumberFormat(formatLocale(locale), {
    style: 'currency',
    currency,
    currencyDisplay: locale === 'ar' ? 'symbol' : 'code',
  });
  // Intl formats decimal strings exactly (no conversion through binary floating point).
  return format.format(amount as unknown as number);
}

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(formatLocale(locale), options).format(value);
}

/** Date and time in the user's timezone (default Asia/Kuwait, ADR-0005). */
export function formatDate(
  locale: Locale,
  value: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'full' },
  timeZone = 'Asia/Kuwait',
) {
  return new Intl.DateTimeFormat(formatLocale(locale), { timeZone, ...options }).format(value);
}
