/** One entry in the command palette (Ctrl K). Modules add pages, actions and searchable records. */
export interface Command {
  id: string;
  group: 'pages' | 'actions' | 'members';
  label: string;
  /** Second line, e.g. an email address. */
  hint?: string | undefined;
  /** Extra words that should find it (e.g. the other language's name of a page). */
  keywords?: string[];
  run: () => void;
}

/**
 * Lower-case, accents and Arabic diacritics removed, Arabic letter variants unified
 * (أ إ آ → ا, ى → ي, ة → ه) so "ادارة" finds "إدارة".
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

/**
 * Commands whose label, hint or keywords contain every word of the query (any order).
 * Labels starting with the query come first; otherwise the original order is kept.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  const scored = commands.flatMap((command, index) => {
    const label = normalize(command.label);
    const haystack = [
      label,
      normalize(command.hint ?? ''),
      ...(command.keywords ?? []).map(normalize),
    ].join(' ');
    if (!words.every((word) => haystack.includes(word))) return [];
    return [{ command, index, starts: label.startsWith(words[0] ?? '') ? 0 : 1 }];
  });
  scored.sort((a, b) => a.starts - b.starts || a.index - b.index);
  return scored.map((s) => s.command);
}
