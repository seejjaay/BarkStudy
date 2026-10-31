import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_LINE_KEYS, GUILT_LINES, LAST_GUILT_LINES } from '../../src/engine/lines';
import { EN, say } from '../../src/shared/i18n/en';

describe('en', () => {
  it('every engine line key has text', () => {
    expect(ALL_LINE_KEYS).toHaveLength(51);
    for (const key of ALL_LINE_KEYS) {
      expect(typeof EN[key], key).toBe('string');
      expect(EN[key]!.trim(), key).not.toBe('');
    }
  });

  it('guilt lines take minutes', () => {
    for (const key of [...GUILT_LINES, ...LAST_GUILT_LINES]) expect(EN[key], key).toContain('{minutes}');
    const text = say(GUILT_LINES[0]!, { minutes: 6 });
    expect(text).toContain('6');
    expect(text).not.toContain('{');
  });

  it('only guilt lines carry a placeholder', () => {
    const guilt = new Set([...GUILT_LINES, ...LAST_GUILT_LINES]);
    for (const key of ALL_LINE_KEYS) if (!guilt.has(key)) expect(EN[key], key).not.toMatch(/[{}]/);
  });

  it('no line calls Pandesal she', () => {
    for (const [key, text] of Object.entries(EN)) expect(text, key).not.toMatch(/\b(she|her|hers)\b/i);
  });

  it('says a plain line as written', () => {
    const key = ALL_LINE_KEYS[0]!;
    expect(say(key)).toBe(EN[key]);
  });

  it('unknown key gives null', () => {
    expect(say('line.nope.1')).toBeNull();
    expect(say('')).toBeNull();
    // Object.prototype members are not lines.
    expect(say('toString')).toBeNull();
    expect(say('__proto__')).toBeNull();
  });
});

// The control window and the tray take every word from src/shared/i18n/en/. This reads their source for English that slipped back in.
describe('no English outside i18n', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = [
    ...readdirSync(join(root, 'src/renderer/control'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => join('src/renderer/control', f)),
    'src/main/trayModel.ts',
  ];

  // Comments hold words by design; template substitutions are code, not text.
  const strip = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/\$\{[^}]*\}/g, '');

  // Text straight after a tag (arrows, comparisons and generic brackets excluded), and text straight after a {expression} on the same line.
  const JSX_TEXT = /(?<![=\s-])>\s*[A-Za-z][^<{>]*<|\}[ \t]*[A-Za-z][A-Za-z ,.'’!?:&;-]*</g;
  const ATTR_WORDS = /\b(?:label:|title=|aria-label=|placeholder=|hint=)\s*\{?\s*(['"`])[^'"`\n]*[A-Za-z][^'"`\n]*\1/g;

  it('finds the control window and tray files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file} has no hard-coded text`, () => {
      const src = strip(readFileSync(join(root, file), 'utf8'));
      const found = [...(src.match(JSX_TEXT) ?? []), ...(src.match(ATTR_WORDS) ?? [])].map((m) => m.replace(/\s+/g, ' ').trim());
      expect(found).toEqual([]);
    });
  }
});
