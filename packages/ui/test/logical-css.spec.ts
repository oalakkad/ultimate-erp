import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-0006: logical CSS only, so Arabic (right-to-left) works without separate styles.
// Physical left/right properties and Tailwind utilities are refused in UI code.

const ROOTS = ['../src', '../../../apps/web/src'].map((p) => new URL(p, import.meta.url).pathname);

/** Tailwind utilities with a physical direction (logical equivalents: ms/me, ps/pe, start/end…). */
const PHYSICAL_UTILITY =
  /^(?:[\w-]+:)*-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr|text-left|text-right|float-left|float-right|clear-left|clear-right)(?:-|$)/;

/** Physical CSS properties and values. */
const PHYSICAL_CSS =
  /\b(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|float\s*:\s*(?:left|right)\b/m;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) && !name.endsWith('.spec.ts') && !name.endsWith('.spec.tsx')
      ? [path]
      : [];
  });
}

describe('logical CSS only', () => {
  const all = ROOTS.flatMap((root) => {
    try {
      return files(decodeURIComponent(root.replace(/^\/([A-Z]:)/, '$1')));
    } catch {
      return [];
    }
  });

  it('scans the UI and web sources', () => {
    expect(all.length).toBeGreaterThan(5);
  });

  it('uses no physical left/right Tailwind utilities', () => {
    const problems: string[] = [];
    for (const file of all.filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(file, 'utf8');
      for (const literal of source.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
        for (const token of (literal[2] ?? '').split(/\s+/)) {
          if (PHYSICAL_UTILITY.test(token)) problems.push(`${file}: ${token}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('uses no physical left/right CSS properties', () => {
    const problems = all
      .filter((f) => f.endsWith('.css'))
      .filter((f) => PHYSICAL_CSS.test(readFileSync(f, 'utf8')));
    expect(problems).toEqual([]);
  });
});
