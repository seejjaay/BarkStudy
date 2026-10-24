export interface CardInput {
  front: string;
  back: string;
}

/** Why a row was left out. The UI maps these codes to text (all user-facing strings live in i18n). */
export type SkipReason = 'no-separator' | 'empty-front' | 'empty-back' | 'header-row';

export interface SkippedRow {
  /** 1-based line where the row starts. */
  line: number;
  reason: SkipReason;
}

export interface ParsedDeck {
  cards: CardInput[];
  skipped: SkippedRow[];
}

const HEADER_WORDS = new Set(['front', 'back', 'question', 'answer', 'term', 'definition', 'word', 'meaning', 'prompt', 'response']);
const norm = (s: string) => s.trim().toLowerCase();

/** A first row like "Term,Definition" is a header, not a card. */
export function looksLikeHeader(front: string, back: string): boolean {
  const a = norm(front);
  const b = norm(back);
  return a !== b && HEADER_WORDS.has(a) && HEADER_WORDS.has(b);
}

interface RawRecord {
  fields: string[];
  line: number;
}

const SEPARATORS: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|' };
const DETECTABLE = ['\t', ',', ';'] as const; // in order of preference when scores tie
const DIRECTIVE = /^#\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/;

/** Closing quote of a quoted field that starts at `from` (the index after the opening quote), or null if there is none. */
function scanQuoted(text: string, from: number): { value: string; end: number } | null {
  let value = '';
  for (let i = from; i < text.length; i++) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        return { value, end: i + 1 };
      }
    } else {
      value += text[i];
    }
  }
  return null;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/**
 * RFC 4180 tokenizer. A quote that cannot open a quoted field (mid-field, or with no closing quote) is kept as a
 * literal character and counted in `literalQuotes`: a delimiter that produces many of those is probably the wrong one.
 */
function tokenize(text: string, delim: string, firstLine: number): { records: RawRecord[]; literalQuotes: number } {
  const records: RawRecord[] = [];
  let literalQuotes = 0;
  let fields: string[] = [];
  let field = '';
  let atStart = true; // only whitespace so far in this field: a quote here opens a quoted field
  let line = firstLine;
  let recordLine = firstLine;
  let i = 0;

  const endRecord = () => {
    if (fields.length > 0 || field !== '') {
      fields.push(field);
      records.push({ fields, line: recordLine });
    }
    fields = [];
    field = '';
    atStart = true;
  };

  while (i < text.length) {
    const c = text[i]!;
    if (c === '"' && atStart) {
      const quoted = scanQuoted(text, i + 1);
      if (quoted) {
        line += countNewlines(text.slice(i, quoted.end));
        field = quoted.value;
        atStart = false;
        i = quoted.end;
        continue;
      }
    }
    if (c === '"') literalQuotes++;
    if (c === delim) {
      fields.push(field);
      field = '';
      atStart = true;
    } else if (c === '\n') {
      line++;
      endRecord();
      recordLine = line;
    } else {
      field += c;
      if (c.trim() !== '') atStart = false;
    }
    i++;
  }
  endRecord();
  return { records, literalQuotes };
}

const isBlank = (r: RawRecord) => r.fields.every((f) => f.trim() === '');

/** Lexicographic comparison of score tuples: bigger wins, earlier entries matter more. */
function isBetter(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!;
  }
  return false;
}

/**
 * Picks the delimiter that splits the most rows into 2+ columns; ties go to the one that tore fewer quotes apart, then to
 * consistent column counts, then to tab, comma, semicolon in that order.
 */
function detectDelimiter(text: string, firstLine: number): string {
  const sample = text.slice(0, 20_000);
  let best = '\t';
  let bestScore: [number, number, number] = [-1, 0, 0];
  for (const delim of DETECTABLE) {
    const { records, literalQuotes } = tokenize(sample, delim, firstLine);
    const multi = records.filter((r) => !isBlank(r) && r.fields.length >= 2);
    const counts = new Map<number, number>();
    for (const r of multi) counts.set(r.fields.length, (counts.get(r.fields.length) ?? 0) + 1);
    const score: [number, number, number] = [multi.length, -literalQuotes, Math.max(0, ...counts.values())];
    if (isBetter(score, bestScore)) {
      best = delim;
      bestScore = score;
    }
  }
  return best;
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** A field that starts with = + - @ is exported with a leading apostrophe so spreadsheets do not run it; undo that here. */
const FORMULA_ESCAPED = /^'+[=+\-@]/;
const FORMULA_LIKE = /^'*[=+\-@]/;

function cell(raw: string, html: boolean): string {
  let s = raw.trim();
  if (html) s = stripHtml(s).trim();
  if (FORMULA_ESCAPED.test(s)) s = s.slice(1);
  return s;
}

/**
 * Parses pasted or imported deck text (Excel CSV, Quizlet and Anki exports, pasted lines) into cards.
 * Delimiter is detected (tab, comma, semicolon) unless a `#separator:` directive names it. Blank rows vanish;
 * every other row that is not a card is reported in `skipped`.
 */
export function parseDeck(input: string): ParsedDeck {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // Leading "#key:value" lines are Anki-style directives, not cards.
  const lines = text.split('\n');
  const directives = new Map<string, string>();
  let consumed = 0;
  while (consumed < lines.length) {
    const m = DIRECTIVE.exec(lines[consumed]!);
    if (!m) break;
    directives.set(m[1]!.toLowerCase(), m[2]!.trim().toLowerCase());
    consumed++;
  }
  const body = lines.slice(consumed).join('\n');
  const firstLine = consumed + 1;
  const html = directives.get('html') === 'true';
  const delim = SEPARATORS[directives.get('separator') ?? ''] ?? detectDelimiter(body, firstLine);

  const cards: CardInput[] = [];
  const skipped: SkippedRow[] = [];
  let headerChecked = false;
  for (const record of tokenize(body, delim, firstLine).records) {
    const cells = record.fields.map((f) => cell(f, html));
    if (cells.every((c) => c === '')) continue;
    if (cells.length < 2) {
      skipped.push({ line: record.line, reason: 'no-separator' });
      continue;
    }
    const front = cells[0]!;
    const back = cells[1]!;
    if (!headerChecked) {
      headerChecked = true;
      if (looksLikeHeader(front, back)) {
        skipped.push({ line: record.line, reason: 'header-row' });
        continue;
      }
    }
    if (front === '') skipped.push({ line: record.line, reason: 'empty-front' });
    else if (back === '') skipped.push({ line: record.line, reason: 'empty-back' });
    else cards.push({ front, back });
  }
  return { cards, skipped };
}

function exportField(s: string): string {
  const guarded = FORMULA_LIKE.test(s) ? `'${s}` : s;
  return /[",;\t\n\r]/.test(guarded) || guarded.startsWith('#') ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** CSV that Excel opens correctly (BOM, CRLF) and that `parseDeck` reads back unchanged. */
export function exportDeck(cards: readonly CardInput[]): string {
  return '\uFEFF' + cards.map((c) => `${exportField(c.front)},${exportField(c.back)}\r\n`).join('');
}
