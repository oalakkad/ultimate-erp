import { type ViewMode } from '@ultimate-erp/ui';
import { useState } from 'react';
import { readPreference, writePreference } from '../app/preferences.js';

/** Card/table choice for one list, remembered per browser (a convenience; works without storage). */
export function useViewMode(list: string, fallback: ViewMode = 'cards') {
  const [mode, setMode] = useState<ViewMode>(() => {
    const saved = readPreference(`view.${list}`);
    return saved === 'cards' || saved === 'table' ? saved : fallback;
  });
  return [
    mode,
    (next: ViewMode) => {
      setMode(next);
      writePreference(`view.${list}`, next);
    },
  ] as const;
}

/** Whole days from today (Kuwait calendar date) to `iso`; negative when in the past. */
export function daysFromToday(iso: string): number {
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}
