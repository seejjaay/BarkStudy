import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineHost, type CardPrompt, type EngineHost, type HostSink, type StartOptions } from '../../src/main/engineHost';
import type { Card } from '../../src/shared/model';
import { newCard } from '../../src/shared/srs';

const MIN = 60_000;
const T0 = 1_790_000_000_000;

const cards = (): Card[] => [newCard('c1', 'capital of France', 'Paris', T0), newCard('c2', 'capital of Peru', 'Lima', T0)];
const opts = (over: Partial<StartOptions> = {}): StartOptions => ({
  cards: cards(),
  cap: 4,
  preset: 'classic',
  checkinMinMinutes: 1,
  checkinMaxMinutes: 1,
  ...over,
});

interface Recorded {
  calls: string[];
  shown: CardPrompt[];
  says: string[];
  treats: number;
  hides: number;
  walks: number[];
  effects: string[];
}

function makeSink(): { sink: HostSink; rec: Recorded } {
  const rec: Recorded = { calls: [], shown: [], says: [], treats: 0, hides: 0, walks: [], effects: [] };
  const sink: HostSink = {
    showCard: (c) => {
      rec.calls.push('show');
      rec.shown.push(c);
    },
    hideCard: () => {
      rec.calls.push('hide');
      rec.hides++;
    },
    say: (line) => {
      rec.calls.push(`say:${line}`);
      rec.says.push(line);
    },
    expression: (name) => rec.calls.push(`expr:${name}`),
    walkTo: (id) => {
      rec.calls.push(`walk:${id}`);
      rec.walks.push(id);
    },
    effect: (a) => {
      rec.calls.push(`effect:${a.type}`);
      rec.effects.push(a.type);
    },
    treat: () => {
      rec.calls.push('treat');
      rec.treats++;
    },
    guiltTrip: (waitedMs) => rec.calls.push(`guilt:${waitedMs}`),
  };
  return { sink, rec };
}

let host: EngineHost | null = null;
function setup(seed = 7) {
  const { sink, rec } = makeSink();
  const reviewed: Card[] = [];
  host = createEngineHost({ seed, sink, onReviewed: (c) => reviewed.push(c) });
  return { host, rec, reviewed, sink };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  host?.dispose();
  host = null;
  vi.useRealTimers();
});

describe('starting and ending', () => {
  it('refuses an empty deck, and a second start while one is running', () => {
    const { host } = setup();
    expect(() => host.start(opts({ cards: [] }))).toThrow(/no cards/i);
    host.start(opts());
    expect(() => host.start(opts())).toThrow(/already/i);
  });

  it('ticks only while a session runs', () => {
    const { host } = setup();
    expect(vi.getTimerCount()).toBe(0);
    host.start(opts());
    expect(vi.getTimerCount()).toBe(1);
    host.end();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('end() summarises the session and a new session starts from zero', () => {
    const { host } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    expect(host.answer('good')).toBe(true);
    const first = host.end();
    expect(first).toMatchObject({ answered: 1, treats: 1, startedAt: T0, endedAt: T0 + 61_000 });
    expect(first.longestWaitMs).toBeGreaterThanOrEqual(0);
    host.start(opts());
    expect(host.end()).toMatchObject({ answered: 0, treats: 0, longestWaitMs: 0, guiltTrips: [] });
  });
});

describe('the study loop', () => {
  it('shows a card at the check-in, not before', () => {
    const { host, rec } = setup();
    host.start(opts());
    vi.advanceTimersByTime(55_000);
    expect(rec.shown).toEqual([]);
    vi.advanceTimersByTime(10_000);
    expect(rec.shown).toHaveLength(1);
    expect(rec.shown[0]).toMatchObject({ id: 'c1', front: 'capital of France', back: 'Paris' });
  });

  it('keeps asking the same card until it is answered', () => {
    const { host, rec } = setup();
    host.start(opts());
    vi.advanceTimersByTime(10 * MIN);
    expect(rec.shown.length).toBeGreaterThanOrEqual(1);
    expect(new Set(rec.shown.map((c) => c.id))).toEqual(new Set(['c1']));
  });

  it('a good answer reviews the card, hides the bubble, awards a treat and reports the new card state', () => {
    const { host, rec, reviewed } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    expect(host.answer('good')).toBe(true);
    expect(rec.treats).toBe(1);
    expect(rec.hides).toBe(1);
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toMatchObject({ id: 'c1' });
    expect(reviewed[0]!.fsrs.reps).toBe(1);
    expect(reviewed[0]!.fsrs.lastReview).toBe(T0 + 61_000);
  });

  it('a missed answer still reviews the card but gives no treat', () => {
    const { host, rec, reviewed } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    host.answer('again');
    expect(rec.treats).toBe(0);
    expect(reviewed).toHaveLength(1);
    expect(host.end()).toMatchObject({ answered: 1, treats: 0 });
  });

  it('the next card is a different one once the first has been answered', () => {
    const { host, rec } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    host.answer('good');
    vi.advanceTimersByTime(2 * MIN);
    expect(rec.shown.at(-1)?.id).toBe('c2');
  });

  it('answering with no card up does nothing', () => {
    const { host, reviewed } = setup();
    host.start(opts());
    expect(host.answer('good')).toBe(false);
    expect(reviewed).toEqual([]);
    expect(host.end().answered).toBe(0);
  });

  it('a long wait before answering is recorded as a guilt trip with its time', () => {
    const { host } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    vi.advanceTimersByTime(3 * MIN);
    host.answer('good');
    const summary = host.end();
    expect(summary.guiltTrips).toHaveLength(1);
    expect(summary.guiltTrips[0]!.waitedMs).toBeGreaterThanOrEqual(2 * MIN);
    expect(summary.guiltTrips[0]!.at).toBe(T0 + 61_000 + 3 * MIN);
    expect(summary.longestWaitMs).toBe(summary.guiltTrips[0]!.waitedMs);
  });

  it('a guilt trip reaches the sink, after the answer’s expression and line', () => {
    const { host, rec } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    vi.advanceTimersByTime(3 * MIN);
    host.answer('good');
    const waited = host.end().guiltTrips[0]!.waitedMs;
    const guilt = rec.calls.indexOf(`guilt:${waited}`);
    expect(guilt).toBeGreaterThan(-1);
    expect(rec.calls.filter((c) => c.startsWith('guilt:'))).toHaveLength(1);
    const last = (prefix: string) => rec.calls.reduce((at, c, i) => (c.startsWith(prefix) ? i : at), -1);
    expect(guilt).toBeGreaterThan(last('expr:'));
    expect(guilt).toBeGreaterThan(last('say:'));
  });

  it('a quick answer is no guilt trip', () => {
    const { host, rec } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    host.answer('good');
    expect(rec.calls.some((c) => c.startsWith('guilt:'))).toBe(false);
  });

  it('tuning passed at the start overrides the check-in minutes', () => {
    const { host, rec } = setup();
    host.start(opts({ tuning: { checkinMinMs: 1000, checkinMaxMs: 1000 } }));
    vi.advanceTimersByTime(1250);
    expect(rec.shown).toHaveLength(1);
  });

  it('ending a session with a card up hides the bubble', () => {
    const { host, rec } = setup();
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    host.end();
    expect(rec.hides).toBe(1);
    expect(rec.calls.at(-1)).toBe('hide');
  });

  it('pausing holds the check-in, resuming brings it back', () => {
    const { host, rec } = setup();
    host.start(opts());
    host.dispatch({ type: 'PAUSE' });
    vi.advanceTimersByTime(10 * MIN);
    expect(rec.shown).toEqual([]);
    host.dispatch({ type: 'RESUME' });
    vi.advanceTimersByTime(61_000);
    expect(rec.shown).toHaveLength(1);
  });
});

describe('status', () => {
  it('reports pause, stay with its time left, away and the card being up', () => {
    const { host } = setup();
    host.start(opts());
    expect(host.status()).toEqual({
      paused: false,
      stay: false,
      stayLeftMs: null,
      activity: 'active',
      suppressed: false,
      cardUp: false,
      answered: 0,
      treats: 0,
    });
    host.dispatch({ type: 'PAUSE' });
    expect(host.status().paused).toBe(true);
    host.dispatch({ type: 'RESUME' });
    host.dispatch({ type: 'STAY_ON', durationMs: 15 * MIN });
    expect(host.status()).toMatchObject({ stay: true, stayLeftMs: 15 * MIN });
    vi.advanceTimersByTime(5 * MIN);
    expect(host.status().stayLeftMs).toBeLessThanOrEqual(10 * MIN);
    expect(host.status().stayLeftMs).toBeGreaterThan(10 * MIN - 1000);
    vi.advanceTimersByTime(10 * MIN + 1000);
    expect(host.status()).toMatchObject({ stay: false, stayLeftMs: null });
    host.dispatch({ type: 'USER_ACTIVITY', state: 'away' });
    host.dispatch({ type: 'SUPPRESS_CHANGED', on: true });
    expect(host.status()).toMatchObject({ activity: 'away', suppressed: true });
  });
});

describe('state that outlives a session', () => {
  it('a screen that is locked or suppressed when the session starts stays quiet', () => {
    const { host, rec } = setup();
    host.dispatch({ type: 'USER_ACTIVITY', state: 'locked' });
    host.start(opts());
    vi.advanceTimersByTime(10 * MIN);
    expect(rec.shown).toEqual([]);
    host.dispatch({ type: 'USER_ACTIVITY', state: 'active' });
    host.dispatch({ type: 'SUPPRESS_CHANGED', on: true });
    host.end();
    host.start(opts());
    vi.advanceTimersByTime(10 * MIN);
    expect(rec.shown).toEqual([]);
  });

  it('events sent while no session runs are not logged or stepped', () => {
    const { host } = setup();
    host.dispatch({ type: 'PAUSE' });
    expect(host.diagnostics().entries).toEqual([]);
  });
});

describe('what the engine drives outward', () => {
  it('an unanswered card escalates into dog actions that name the active window', () => {
    const { host, rec } = setup();
    host.start(opts());
    host.setActiveWindow(42);
    vi.advanceTimersByTime(30 * MIN);
    const dogThings = rec.calls.filter((c) => c.startsWith('walk:') || c.startsWith('effect:') || c.startsWith('say:'));
    expect(dogThings.length).toBeGreaterThan(0);
    expect(rec.walks.every((id) => id === 42)).toBe(true);
  });

  it('with no active window there is nothing to walk to', () => {
    const { host, rec } = setup();
    host.start(opts());
    vi.advanceTimersByTime(30 * MIN);
    expect(rec.walks).toEqual([]);
  });

  it('the same seed and the same inputs make the same outputs', () => {
    const run = (): string[] => {
      const { host, rec } = setup(99);
      host.start(opts());
      host.setActiveWindow(5);
      vi.advanceTimersByTime(20 * MIN);
      host.dispose();
      return rec.calls;
    };
    const a = run();
    const b = run();
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});

describe('diagnostics log', () => {
  it('records event types, time deltas and the seed, and never card text', () => {
    const { host } = setup(1234);
    host.start(opts());
    vi.advanceTimersByTime(61_000);
    host.answer('good');
    const d = host.diagnostics();
    expect(d.seed).toBe(1234);
    const types = d.entries.map((e) => e.type);
    expect(types).toContain('SESSION_START');
    expect(types).toContain('TICK');
    expect(types).toContain('ANSWER_SUBMITTED');
    const text = JSON.stringify(d);
    expect(text).not.toContain('France');
    expect(text).not.toContain('Paris');
  });

  it('merges consecutive ticks, so a long idle stretch is one entry', () => {
    const { host } = setup();
    host.start(opts({ checkinMinMinutes: 60, checkinMaxMinutes: 60 }));
    vi.advanceTimersByTime(5 * MIN);
    const ticks = host.diagnostics().entries.filter((e) => e.type === 'TICK');
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.dtMs).toBeGreaterThanOrEqual(5 * MIN - 250);
  });

  it('is a rolling window: it never grows past its capacity', () => {
    const { sink } = makeSink();
    const small = createEngineHost({ seed: 1, sink, logCapacity: 20 });
    small.start(opts({ checkinMinMinutes: 60, checkinMaxMinutes: 60 }));
    for (let i = 0; i < 100; i++) small.dispatch(i % 2 ? { type: 'PAUSE' } : { type: 'RESUME' });
    expect(small.diagnostics().entries).toHaveLength(20);
    small.dispose();
  });
});
