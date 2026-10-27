import { describe, expect, it } from 'vitest';
import { catalogs, format } from './index.js';

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [p, v] of leaves(value, path)) out.set(p, v);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogs', () => {
  const en = leaves(catalogs.en);
  const ar = leaves(catalogs.ar);

  it('Arabic has exactly the English keys', () => {
    expect([...ar.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it('no Arabic text is empty or left in English', () => {
    for (const [key, text] of ar) {
      expect(text.trim(), key).not.toBe('');
      if (key !== 'email.signature') expect(text, key).not.toBe(en.get(key));
    }
  });

  it('each translation uses the same placeholders', () => {
    for (const [key, text] of en) {
      expect(placeholders(ar.get(key) ?? ''), key).toEqual(placeholders(text));
    }
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('Hi {name}, {missing}', { name: 'Omar' })).toBe('Hi Omar, {missing}');
  });
});
