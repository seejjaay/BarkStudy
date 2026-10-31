import { describe, expect, it } from 'vitest';
import type { DeckSummary, ErrorCode, SessionView } from '../../src/shared/control';
import type { SkipReason } from '../../src/shared/deckParse';
import { badgeFor, parseStart } from '../../src/renderer/control/sessionState';
import { ERROR_TEXT, SKIP_TEXT, deckLabel, formatClock, formatDuration, formatWhen, importMessage, plural } from '../../src/renderer/control/text';

type Running = Extract<SessionView, { phase: 'running' }>;
const running = (over: Partial<Running> = {}): Running => ({
  phase: 'running',
  deckId: 'd',
  deckName: 'Deck',
  topic: '',
  startedAt: 0,
  paused: false,
  stay: false,
  stayLeftMs: null,
  away: false,
  suppressed: false,
  card: null,
  answered: 0,
  treats: 0,
  saveProblem: false,
  ...over,
});
const deck = (over: Partial<DeckSummary> = {}): DeckSummary => ({ id: 'd1', name: 'French', createdAt: 0, cardCount: 5, ...over });

describe('words', () => {
  it('every error code and every skip reason has text, and none is empty', () => {
    const codes: ErrorCode[] = [
      'invalid-name', 'duplicate-name', 'not-found', 'already-exists', 'no-valid-rows', 'store-unavailable', 'write-failed',
      'empty-deck', 'already-running', 'not-running', 'invalid-request', 'duplicate-card', 'invalid-card', 'deck-in-use',
      'file-unreadable', 'file-too-large', 'not-a-backup', 'newer-version', 'hotkey-taken', 'hotkey-invalid', 'session-running', 'partly-replaced',
    ];
    expect(Object.keys(ERROR_TEXT).sort()).toEqual([...codes].sort());
    // After a partial restore the old files are the user's way back, so the message must point at them.
    expect(ERROR_TEXT['partly-replaced']).toMatch(/backups folder/);
    expect(ERROR_TEXT['partly-replaced']).not.toMatch(/nothing was changed/i);
    const reasons: SkipReason[] = ['no-separator', 'empty-front', 'empty-back', 'header-row'];
    expect(Object.keys(SKIP_TEXT).sort()).toEqual([...reasons].sort());
    for (const t of [...Object.values(ERROR_TEXT), ...Object.values(SKIP_TEXT)]) expect(t.length).toBeGreaterThan(5);
  });

  it.each([
    [0, '0 s'],
    [45_000, '45 s'],
    [60_000, '1 min'],
    [130_000, '2 min 10 s'],
    [3_900_000, '1 h 05 min'],
    [-5, '0 s'],
  ])('formatDuration(%i) = %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it.each([
    [0, '0:00'],
    [1, '0:01'],
    [872_000, '14:32'],
    [3_725_000, '1:02:05'],
  ])('formatClock(%i) = %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });

  it('formatWhen says today, yesterday, then dates, in local time', () => {
    const now = new Date(2026, 9, 25, 15, 0).getTime();
    expect(formatWhen(new Date(2026, 9, 25, 9, 5).getTime(), now)).toBe('Today 09:05');
    expect(formatWhen(new Date(2026, 9, 24, 23, 59).getTime(), now)).toBe('Yesterday 23:59');
    expect(formatWhen(new Date(2026, 9, 12, 14, 5).getTime(), now)).toBe('12 Oct 14:05');
    expect(formatWhen(new Date(2025, 11, 31, 8, 0).getTime(), now)).toBe('31 Dec 2025 08:00');
  });

  it('plural and the import message read naturally', () => {
    expect(plural(1, 'card')).toBe('1 card');
    expect(plural(2, 'card')).toBe('2 cards');
    expect(plural(0, 'deck')).toBe('0 decks');
    expect(importMessage({ deckId: 'd', added: 1, duplicates: 0, skipped: [] }, 'French')).toBe('Added 1 card to French.');
    expect(importMessage({ deckId: 'd', added: 12, duplicates: 2, skipped: [{ line: 3, reason: 'no-separator' }] }, 'French')).toBe(
      'Added 12 cards to French. 2 rows already there. 1 row skipped.',
    );
    expect(deckLabel({ name: 'French', cardCount: 1 })).toBe('French (1 card)');
  });
});

describe('badgeFor', () => {
  it('names the state in words, and the most binding one wins', () => {
    expect(badgeFor(running()).label).toBe('Running');
    expect(badgeFor(running({ suppressed: true })).label).toBe('Quiet');
    expect(badgeFor(running({ suppressed: true, away: true })).label).toBe('Away');
    expect(badgeFor(running({ away: true, stay: true, stayLeftMs: 60_000 })).label).toBe('Staying');
    expect(badgeFor(running({ stay: true, paused: true, stayLeftMs: 1 })).label).toBe('Paused');
  });

  it('a stay shows the time left', () => {
    expect(badgeFor(running({ stay: true, stayLeftMs: 872_000 })).detail).toContain('14:32 left');
  });

  it('every kind is distinct, so they can be told apart without colour', () => {
    const kinds = [running(), running({ paused: true }), running({ stay: true }), running({ away: true }), running({ suppressed: true })].map((v) => badgeFor(v).label);
    expect(new Set(kinds).size).toBe(5);
  });

  it('says whether a card is waiting', () => {
    expect(badgeFor(running({ card: { id: 'c', front: 'q', back: 'a' } })).detail).toMatch(/waiting for your answer/);
  });
});

describe('parseStart', () => {
  const base = { deckId: 'd1', topic: '', min: '5', max: '15' };

  it('builds the request from the form', () => {
    expect(parseStart({ ...base, topic: '  Week 3 ' }, [deck()])).toEqual({
      ok: true,
      request: { deckId: 'd1', topic: 'Week 3', checkinMinMinutes: 5, checkinMaxMinutes: 15 },
    });
  });

  it('gives a reason for every way Start can be blocked', () => {
    const reason = (p: ReturnType<typeof parseStart>) => (p.ok ? null : p.reason);
    expect(reason(parseStart(base, []))).toMatch(/first/);
    expect(reason(parseStart({ ...base, deckId: '' }, [deck()]))).toMatch(/Pick a deck/);
    expect(reason(parseStart(base, [deck({ cardCount: 0 })]))).toMatch(/no cards/);
    expect(reason(parseStart({ ...base, min: '0' }, [deck()]))).toMatch(/whole minutes/);
    expect(reason(parseStart({ ...base, min: '' }, [deck()]))).toMatch(/whole minutes/);
    expect(reason(parseStart({ ...base, min: '1.5' }, [deck()]))).toMatch(/whole minutes/);
    expect(reason(parseStart({ ...base, min: '20', max: '10' }, [deck()]))).toMatch(/whole minutes/);
    expect(reason(parseStart({ ...base, max: '241' }, [deck()]))).toMatch(/whole minutes/);
    expect(reason(parseStart({ ...base, topic: 'x'.repeat(81) }, [deck()]))).toMatch(/80/);
  });

  it('allows the same minute for both ends', () => {
    expect(parseStart({ ...base, min: '10', max: '10' }, [deck()]).ok).toBe(true);
  });
});
