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

// Comments hold words by design; template substitutions are code, not text.
const strip = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\$\{[^}]*\}/g, '');

// Text between a tag's `>` and the next `<` or `{`, starting with a letter or digit (a generic's `>` is followed by `(`, `;` and so on).
// `>` after `=` (arrow) or a space (comparison) is not a tag.
const AFTER_TAG = /(?<![=\s-])>\s*([A-Za-z0-9][^<{>]*)(?=[<{])/g;
// Text between an expression's `}` and the next `<` or `{`. Code can follow a `}` too, so runs with code marks or a statement keyword are skipped.
const AFTER_EXPR = /\}\s*([A-Za-z0-9][^<{>}]*)(?=[<{])/g;
const CODE_RUN = /[();=[\]]|^\s*(?:else|return|try|catch|finally|do|if|for|while|switch|case|default|break|continue|const|let|var|function|async|await|class|interface|type|enum|export|import|declare|namespace|abstract|void|throw|new)\b/;
// Words given to a prop or entry instead of read from i18n: label="Name", alt="A dog", label: 'Study'.
const ATTR_WORDS = /\b(?:label|title|aria-label|aria-description|placeholder|hint|alt|legend|note)\s*[=:]\s*\{?\s*(['"`])[^'"`\n]*[A-Za-z][^'"`\n]*\1/g;
// A string literal that reads as words (a space, or a capital) as a ternary branch or && result. Class names are removed first.
const CLASS_NAMES = /className=\{[^{}]*\}/g;
const LITERAL_RESULT = /(?:\?|:|&&)\s*(['"`])((?=[^'"`\n]*[A-Za-z][^'"`\n]*[A-Za-z])(?:[^'"`\n]* [^'"`\n]*|[A-Z][^'"`\n]*))\1/g;

/** The pieces of a source file that look like English written in place instead of read from i18n. */
function findInlineEnglish(source: string): string[] {
  const src = strip(source).replace(CLASS_NAMES, '');
  const found: string[] = [];
  // A run with `=` is the props of a generic component (`<RadioCards<Cap> legend=`), not text.
  for (const m of src.matchAll(AFTER_TAG)) if (/[A-Za-z]/.test(m[1]!) && !m[1]!.includes('=')) found.push(m[1]!);
  for (const m of src.matchAll(AFTER_EXPR)) if (/[A-Za-z]/.test(m[1]!) && !CODE_RUN.test(m[1]!)) found.push(m[1]!);
  for (const m of src.matchAll(ATTR_WORDS)) found.push(m[0]);
  for (const m of src.matchAll(LITERAL_RESULT)) found.push(m[0]);
  return found.map((m) => m.replace(/\s+/g, ' ').trim());
}

describe('the inline-English finder', () => {
  const bad: [string, string][] = [
    ['text before an expression', '<p>Hello {name}</p>'],
    ['words between expressions', '<p>{a} and {b}</p>'],
    ['text starting with a digit', '<p>3 items</p>'],
    ['plain text', '<h1>Title</h1>'],
    ['text on its own lines', '<button>\n  Skip to content\n</button>'],
    ['text after an expression on the next line', '<p>\n  {n}\n  items left\n</p>'],
    ['a ternary of words', "<p>{ok ? 'Yes' : 'No'}</p>"],
    ['a double-quoted ternary', '<p>{ok ? "Saved it" : "Not saved"}</p>'],
    ['a && result', "<p>{ok && 'Saved it'}</p>"],
    ['label=', '<Field label="Name" />'],
    ['alt=', '<img alt="A dog" />'],
    ['aria-description=', '<button aria-description="Closes it" />'],
    ['aria-label=', '<button aria-label="Close" />'],
    ['placeholder=', '<input placeholder="Type here" />'],
    ['a label: entry', "const NAV = [{ id: 'study', label: 'Study' }];"],
  ];
  it.each(bad)('flags %s', (_name, snippet) => {
    expect(findInlineEnglish(snippet), snippet).not.toEqual([]);
  });

  const good: [string, string][] = [
    ['class names', '<button className="btn btn-primary" type="button">'],
    ['class names in a ternary', "<span className={on ? 'dot dot-now' : 'dot'} />"],
    ['a call', '<p>{plural(n, x)}</p>'],
    ['an i18n word', '<h2>{STUDY.title}</h2>'],
    ['other attributes', '<input type="text" inputMode="numeric" role="alert" key="a" href="#main" id="x" data-autofocus />'],
    ['a symbol', '<span aria-hidden="true">×</span>'],
    ['an arrow and generics', 'const f = async (): Promise<void> => { const [a, b] = useState<string | null>(null); };'],
    ['a comparison', 'const c = a > b && c < d;'],
    ['an else', 'if (a) {\n  x();\n} else {\n  y();\n}'],
    ['a short lower-case code', "const k = on ? 'ok' : 'error';"],
  ];
  it.each(good)('does not flag %s', (_name, snippet) => {
    expect(findInlineEnglish(snippet), snippet).toEqual([]);
  });
});

describe('no English outside i18n', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = [
    ...readdirSync(join(root, 'src/renderer/control'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => join('src/renderer/control', f)),
    'src/main/trayModel.ts',
  ];

  it('finds the control window and tray files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file} has no hard-coded text`, () => {
      expect(findInlineEnglish(readFileSync(join(root, file), 'utf8'))).toEqual([]);
    });
  }
});
