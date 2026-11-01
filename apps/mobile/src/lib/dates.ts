/** Calendar helpers (dates are plain YYYY-MM-DD strings, as in the API). */

export function todayIso(now = new Date()): string {
  return isoDate(now);
}

export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return isoDate(date);
}

export const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hours typed by a person: "3", "3.5", "0.25" → normalised string the API accepts, else null. */
export function normaliseHours(input: string): string | null {
  const text = input.trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (!(value > 0 && value <= 24)) return null;
  return text;
}
