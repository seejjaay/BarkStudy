export type Match = 'exact' | 'fuzzy' | 'wrong';

// Combining diacritical marks (U+0300 to U+036F): accents on Latin, Greek and Cyrillic letters. Written with char
// codes so the range survives editors; Japanese voicing marks and Hangul are outside it and must not be stripped.
const COMBINING_DIACRITICS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** Sentence punctuation at the end of an answer. Deliberately not "+", ")" and friends: "C++" is not "C". */
const TRAILING_PUNCTUATION = /[.,;:!?…。、，；：！？]+$/u;

/**
 * Decision 9: NFKC, lowercase, strip diacritics, collapse whitespace, strip trailing punctuation.
 * One addition: German ß becomes "ss" so "Strasse" matches "Straße".
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
}

/** True Damerau-Levenshtein distance (adjacent transpositions cost 1, even inside other edits), over code points. */
export function damerauLevenshtein(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = x.length;
  const m = y.length;
  const width = m + 2;
  const maxDist = n + m;
  const d = new Int32Array((n + 2) * width);
  const at = (i: number, j: number) => d[i * width + j]!;
  const set = (i: number, j: number, v: number) => {
    d[i * width + j] = v;
  };
  set(0, 0, maxDist);
  for (let i = 0; i <= n; i++) {
    set(i + 1, 0, maxDist);
    set(i + 1, 1, i);
  }
  for (let j = 0; j <= m; j++) {
    set(0, j + 1, maxDist);
    set(1, j + 1, j);
  }
  const lastRow = new Map<string, number>();
  for (let i = 1; i <= n; i++) {
    let lastMatchCol = 0;
    for (let j = 1; j <= m; j++) {
      const k = lastRow.get(y[j - 1]!) ?? 0;
      const l = lastMatchCol;
      let cost = 1;
      if (x[i - 1] === y[j - 1]) {
        cost = 0;
        lastMatchCol = j;
      }
      set(
        i + 1,
        j + 1,
        Math.min(at(i, j) + cost, at(i + 1, j) + 1, at(i, j + 1) + 1, at(k, l) + (i - k - 1) + 1 + (j - l - 1)),
      );
    }
    lastRow.set(x[i - 1]!, i);
  }
  return at(n + 1, m + 1);
}

const digitRuns = (s: string) => s.match(/\p{Nd}+/gu) ?? [];

/** 0 typos for expected answers of up to 3 characters, 1 up to 7, 2 above. */
const allowedTypos = (len: number) => (len <= 3 ? 0 : len <= 7 ? 1 : 2);

/**
 * Grades a typed answer: `exact` after normalisation, `fuzzy` within the allowed typos, otherwise `wrong`.
 * Numbers must match exactly, so 1990 never passes for 1991.
 */
export function matchAnswer(given: string, expected: string): Match {
  const g = normalizeAnswer(given);
  const e = normalizeAnswer(expected);
  if (g === '' || e === '') return 'wrong';
  if (g === e) return 'exact';
  const gd = digitRuns(g);
  const ed = digitRuns(e);
  if (gd.length !== ed.length || gd.some((run, i) => run !== ed[i])) return 'wrong';
  const eLen = Array.from(e).length;
  const allowed = allowedTypos(eLen);
  if (allowed === 0 || Math.abs(Array.from(g).length - eLen) > allowed) return 'wrong';
  return damerauLevenshtein(g, e) <= allowed ? 'fuzzy' : 'wrong';
}
