import { type en } from './catalogs/en.js';

/** Same nested keys as the English catalog, any string values. */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Catalog = Widen<typeof en>;

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

/** Writing direction per locale, for `<html dir>` and emails. */
export const DIRECTION: Record<Locale, 'ltr' | 'rtl'> = { en: 'ltr', ar: 'rtl' };
