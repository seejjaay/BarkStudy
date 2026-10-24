import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exportDeck, looksLikeHeader, parseDeck, type CardInput } from '../../src/shared/deckParse';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', 'decks', name), 'utf8');
const card = (front: string, back: string): CardInput => ({ front, back });

describe('parseDeck: real-shaped files', () => {
  it('Excel CSV with BOM and CRLF: quoted commas, doubled quotes, a header row and an empty row', () => {
    const r = parseDeck(fixture('excel-bom-crlf.csv'));
    expect(r.cards).toEqual([
      card('Hello, world', 'Bonjour le monde'),
      card('She said "hi"', 'Elle a dit « salut »'),
      card('café', 'coffee'),
      card('Paris', 'Capital of France, on the Seine'),
    ]);
    expect(r.skipped).toEqual([
      { line: 1, reason: 'header-row' },
      { line: 7, reason: 'empty-back' },
    ]);
  });

  it('Quizlet export (tab separated, commas inside definitions)', () => {
    const r = parseDeck(fixture('quizlet-export.tsv'));
    expect(r.cards).toEqual([
      card('mitochondria', 'Powerhouse of the cell'),
      card('photosynthesis', 'Process by which plants make food, using light'),
      card('ATP', 'Adenosine triphosphate'),
    ]);
    expect(r.skipped).toEqual([]);
  });

  it('Anki TSV: directive lines are not cards, HTML is cleaned, the tags column is ignored', () => {
    const r = parseDeck(fixture('anki.tsv'));
    expect(r.cards).toEqual([card('What is the capital of France?\n(Europe)', 'Paris'), card('2 < 3 is true', 'Yes & always')]);
    expect(r.skipped).toEqual([]);
  });

  it('pasted text with blank lines: blank lines vanish, the heading is reported, trailing spaces are trimmed', () => {
    const r = parseDeck(fixture('pasted-with-blank-lines.txt'));
    expect(r.cards).toEqual([card('dog', 'perro'), card('cat', 'gato'), card('bird', 'pájaro')]);
    expect(r.skipped).toEqual([{ line: 1, reason: 'no-separator' }]);
  });

  it('quoted commas and a quoted multi-line field; later line numbers stay right', () => {
    const r = parseDeck(fixture('quoted-commas.csv'));
    expect(r.cards).toEqual([card('Name three primes, in order', '2, 3, 5'), card('A multi-line\nanswer', 'line one'), card('Plain', 'Card')]);
    expect(r.skipped).toEqual([{ line: 4, reason: 'no-separator' }]);
  });
});

describe('parseDeck: delimiters and edge cases', () => {
  it('detects semicolons (European Excel)', () => {
    expect(parseDeck('uno;one\ndos;two\n').cards).toEqual([card('uno', 'one'), card('dos', 'two')]);
  });

  it('an explicit #separator directive beats detection', () => {
    const r = parseDeck('#separator:comma\na\tb,c\nd\te,f\n');
    expect(r.cards).toEqual([card('a\tb', 'c'), card('d\te', 'f')]);
  });

  it('ignores extra columns', () => {
    expect(parseDeck('a,b,c,d\n').cards).toEqual([card('a', 'b')]);
  });

  it('an unterminated quote is a literal quote and does not swallow the rest of the file', () => {
    const r = parseDeck('"What is,answer\nsecond,card\n');
    expect(r.cards).toEqual([card('"What is', 'answer'), card('second', 'card')]);
  });

  it('reports empty fronts and empty backs', () => {
    const r = parseDeck('a,b\n,b\nc,\n');
    expect(r.cards).toEqual([card('a', 'b')]);
    expect(r.skipped).toEqual([
      { line: 2, reason: 'empty-front' },
      { line: 3, reason: 'empty-back' },
    ]);
  });

  it('input with no delimiter anywhere is all skipped, not a crash', () => {
    const r = parseDeck('just a sentence\nanother one\n');
    expect(r.cards).toEqual([]);
    expect(r.skipped).toEqual([
      { line: 1, reason: 'no-separator' },
      { line: 2, reason: 'no-separator' },
    ]);
  });

  it('empty and whitespace-only input give nothing', () => {
    expect(parseDeck('')).toEqual({ cards: [], skipped: [] });
    expect(parseDeck('  \n\t\n\r\n')).toEqual({ cards: [], skipped: [] });
  });

  it('only the first data row can be a header', () => {
    expect(parseDeck('a,b\nfront,back\n').cards).toEqual([card('a', 'b'), card('front', 'back')]);
    expect(looksLikeHeader('Term', 'Definition')).toBe(true);
    expect(looksLikeHeader('Front', 'Front')).toBe(false);
    expect(looksLikeHeader('Paris', 'Capital')).toBe(false);
  });

  it('lone CR line endings (old Mac exports) work', () => {
    expect(parseDeck('a,b\rc,d\r').cards).toEqual([card('a', 'b'), card('c', 'd')]);
  });

  it('a leading apostrophe that guards a formula is removed', () => {
    expect(parseDeck("'=SUM(A1),'-5\n").cards).toEqual([card('=SUM(A1)', '-5')]);
  });

  it('a tab inside a quoted comma-separated field does not make tab the delimiter', () => {
    // Found by a 30k-run round-trip stress: a NUL-led field with a tab in quotes split on the tab and tied with the comma.
    expect(parseDeck('a,"b\tc"\n').cards).toEqual([card('a', 'b\tc')]);
    expect(parseDeck('\0,"\0\t\0"\n').cards).toEqual([card('\0', '\0\t\0')]);
  });

  it('parses 10,000 rows quickly', () => {
    const text = Array.from({ length: 10_000 }, (_, i) => `term ${i},definition ${i}`).join('\n');
    const t0 = performance.now();
    expect(parseDeck(text).cards).toHaveLength(10_000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('exportDeck', () => {
  it('writes a BOM, CRLF line endings, and quotes only where needed', () => {
    const out = exportDeck([card('plain', 'text'), card('a, b', 'say "hi"'), card('two\nlines', '#tag')]);
    expect(out).toBe('﻿plain,text\r\n"a, b","say ""hi"""\r\n"two\nlines","#tag"\r\n');
  });

  it('guards formula-looking fields against spreadsheet injection', () => {
    const out = exportDeck([card('=1+1', '@cmd'), card('+x', '-5')]);
    expect(out).toBe("﻿'=1+1,'@cmd\r\n'+x,'-5\r\n");
  });

  it('parseDeck(exportDeck(x)) gives x back, for examples including tricky ones', () => {
    const cards = [
      card('Hello, world', 'Bonjour'),
      card('She said "hi"', "it's fine"),
      card('=SUM(A1)', "'=already guarded"),
      card('#separator:tab', '#html:true'),
      card('a;b', 'c\td'),
      card('multi\nline', '日本語 ✓'),
    ];
    expect(parseDeck(exportDeck(cards))).toEqual({ cards, skipped: [] });
  });

  it('round-trips arbitrary cards', () => {
    const text = fc
      .string({ unit: 'binary', minLength: 1, maxLength: 24 })
      .filter((s) => s === s.trim() && s !== '' && !s.includes('\r'));
    const cardArb = fc.record({ front: text, back: text });
    fc.assert(
      fc.property(fc.array(cardArb, { minLength: 1, maxLength: 12 }), (cards) => {
        fc.pre(!looksLikeHeader(cards[0]!.front, cards[0]!.back));
        expect(parseDeck(exportDeck(cards))).toEqual({ cards, skipped: [] });
      }),
      { numRuns: 500 },
    );
  });
});
