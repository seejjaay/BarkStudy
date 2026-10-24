import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { damerauLevenshtein, matchAnswer, normalizeAnswer } from '../../src/shared/matching';

describe('normalizeAnswer', () => {
  it('NFKC, lowercase, strip diacritics, collapse whitespace, strip trailing punctuation', () => {
    expect(normalizeAnswer('  Café   Olé!! ')).toBe('cafe ole');
    expect(normalizeAnswer('ＡＢＣ')).toBe('abc');
    expect(normalizeAnswer('ﬁne')).toBe('fine');
    expect(normalizeAnswer('Straße')).toBe('strasse');
    expect(normalizeAnswer('Paris . ')).toBe('paris');
    expect(normalizeAnswer('がっこう')).toBe('がっこう');
    expect(normalizeAnswer('日本。')).toBe('日本');
  });

  it('keeps punctuation that is part of the answer', () => {
    expect(normalizeAnswer('C++')).toBe('c++');
    expect(normalizeAnswer('(Japan)')).toBe('(japan)');
    expect(normalizeAnswer('3.14')).toBe('3.14');
  });
});

describe('damerauLevenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', '', 3],
    ['', 'abc', 3],
    ['kitten', 'sitting', 3],
    ['ab', 'ba', 1],
    ['berlin', 'berlni', 1],
    ['ca', 'abc', 2],
  ])('(%j, %j) = %i', (a, b, d) => {
    expect(damerauLevenshtein(a, b)).toBe(d);
  });

  it('is symmetric', () => {
    fc.assert(fc.property(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), (a, b) => damerauLevenshtein(a, b) === damerauLevenshtein(b, a)));
  });
});

describe('matchAnswer: exact', () => {
  it('ignores case, spacing, diacritics and trailing punctuation', () => {
    expect(matchAnswer('  PARIS  ', 'Paris')).toBe('exact');
    expect(matchAnswer('new   york', 'New York')).toBe('exact');
    expect(matchAnswer('cafe', 'café')).toBe('exact');
    expect(matchAnswer('café', 'cafe')).toBe('exact');
    expect(matchAnswer('Paris!', 'Paris')).toBe('exact');
    expect(matchAnswer('Paris?', 'Paris.')).toBe('exact');
    expect(matchAnswer('Strasse', 'Straße')).toBe('exact');
    expect(matchAnswer('ＡＢＣ', 'abc')).toBe('exact');
    expect(matchAnswer('１９９０', '1990')).toBe('exact');
  });
});

describe('matchAnswer: fuzzy by length of the expected answer', () => {
  it('1 typo at 6 chars is fuzzy (substitution, deletion, transposition)', () => {
    expect(matchAnswer('Berlen', 'Berlin')).toBe('fuzzy');
    expect(matchAnswer('Berln', 'Berlin')).toBe('fuzzy');
    expect(matchAnswer('Berlni', 'Berlin')).toBe('fuzzy');
  });

  it('2 typos at 6 chars is wrong', () => {
    expect(matchAnswer('Berxxn', 'Berlin')).toBe('wrong');
  });

  it('3 chars or fewer must match exactly', () => {
    expect(matchAnswer('cot', 'cat')).toBe('wrong');
    expect(matchAnswer('no', 'go')).toBe('wrong');
    expect(matchAnswer('ab', 'abc')).toBe('wrong');
    expect(matchAnswer('cat.', 'cat')).toBe('exact');
  });

  it('7 chars allows 1 typo, not 2', () => {
    expect(matchAnswer('Granate', 'Granite')).toBe('fuzzy');
    expect(matchAnswer('Granxte', 'Granite')).toBe('fuzzy');
    expect(matchAnswer('Gronate', 'Granite')).toBe('wrong');
  });

  it('8 chars or more allows 2 typos, not 3', () => {
    expect(matchAnswer('Missisipi', 'Mississippi')).toBe('fuzzy');
    expect(matchAnswer('Misisipi', 'Mississippi')).toBe('wrong');
  });
});

describe('matchAnswer: diacritics are only stripped where they are decoration', () => {
  it('keeps Japanese voicing marks and Korean syllables intact', () => {
    expect(matchAnswer('か', 'が')).toBe('wrong');
    expect(matchAnswer('がっこう', 'がっこう')).toBe('exact');
    expect(matchAnswer('한국어', '한국어')).toBe('exact');
  });
});

describe('matchAnswer: digit runs must match exactly', () => {
  it('1990 vs 1991 is wrong even though they are one edit apart', () => {
    expect(matchAnswer('1991', '1990')).toBe('wrong');
    expect(matchAnswer('in 1991', 'in 1990')).toBe('wrong');
    expect(matchAnswer('Apollo 12', 'Apollo 11')).toBe('wrong');
    expect(matchAnswer('01', '10')).toBe('wrong');
  });

  it('a missing or extra number is wrong', () => {
    expect(matchAnswer('Henry', 'Henry 8')).toBe('wrong');
    expect(matchAnswer('Henry 8', 'Henry')).toBe('wrong');
  });

  it('the same numbers with a typo elsewhere is fuzzy', () => {
    expect(matchAnswer('Appolo 11', 'Apollo 11')).toBe('fuzzy');
    expect(matchAnswer('covid 19', 'COVID-19')).toBe('fuzzy');
  });

  it('matching numbers are exact', () => {
    expect(matchAnswer('In 1990.', 'in 1990')).toBe('exact');
  });
});

describe('matchAnswer: nothing to match', () => {
  it('empty, whitespace and punctuation-only answers are wrong', () => {
    expect(matchAnswer('', 'x')).toBe('wrong');
    expect(matchAnswer('   ', 'Paris')).toBe('wrong');
    expect(matchAnswer('!!!', 'Paris')).toBe('wrong');
  });

  it('an expected answer that normalises to nothing never matches', () => {
    expect(matchAnswer('...', '...')).toBe('wrong');
    expect(matchAnswer('anything', '...')).toBe('wrong');
  });
});

describe('matchAnswer: properties', () => {
  const hasLetterOrDigit = (s: string) => /[\p{L}\p{N}]/u.test(s);

  it('never throws, and returns one of the three grades', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), fc.string({ unit: 'binary', maxLength: 60 }), (a, b) => {
        expect(['exact', 'fuzzy', 'wrong']).toContain(matchAnswer(a, b));
      }),
    );
  });

  it('an answer always matches itself exactly', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }).filter(hasLetterOrDigit), (s) => {
        expect(matchAnswer(s, s)).toBe('exact');
      }),
    );
  });

  it('is fast on long answers', () => {
    const long = 'word '.repeat(60);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) matchAnswer(long + 'x', long + 'y');
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
