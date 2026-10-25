import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result, SessionView, StartRequest } from '../../src/shared/control';
import { createLibrary, type Library } from '../../src/main/library';
import { createSessionController, type SessionController } from '../../src/main/session';
import { createStorage, nodeFs } from '../../src/main/storage/io';

const MIN = 60_000;
const T0 = 1_790_000_000_000;

let dir: string;
let lib: Library;
let views: SessionView[];
let ctl: SessionController | null = null;
let deckId: string;
let ids = 0;

const req = (over: Partial<StartRequest> = {}): StartRequest => ({ deckId, topic: '', checkinMinMinutes: 1, checkinMaxMinutes: 1, ...over });
const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.value;
};
const code = (r: Result<unknown>) => (r.ok ? undefined : r.error.code);
type Running = Extract<SessionView, { phase: 'running' }>;
const running = (v: SessionView): Running => {
  if (v.phase !== 'running') throw new Error(`phase is ${v.phase}`);
  return v;
};

async function build(over: { storageDir?: string } = {}): Promise<SessionController> {
  lib = await createLibrary({ storage: createStorage(over.storageDir ?? dir), newId: () => `id${++ids}` });
  const c = createSessionController({ library: lib, seed: 11, publish: (v) => views.push(v) });
  ctl = c;
  return c;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  dir = fs.mkdtempSync(join(os.tmpdir(), 'barkstudy-session-'));
  views = [];
  ids = 0;
  const c = await build();
  const made = ok(await lib.importAsNewDeck('Capitals', 'France,Paris\nPeru,Lima'));
  deckId = made.deckId;
  void c;
});
afterEach(() => {
  ctl?.dispose();
  ctl = null;
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('starting', () => {
  it('idle until started, then running with the deck and topic', () => {
    const c = ctl!;
    expect(c.view()).toEqual({ phase: 'idle' });
    const v = running(ok(c.start(req({ topic: '  Week 3  ' }))));
    expect(v).toMatchObject({ deckId, deckName: 'Capitals', topic: 'Week 3', startedAt: T0, paused: false, stay: false, away: false, card: null, answered: 0, treats: 0, saveProblem: false });
    expect(c.view()).toEqual(v);
  });

  it('refuses an unknown deck, an empty deck, a second session and bad intervals', async () => {
    const c = ctl!;
    const empty = ok(await lib.createDeck('Empty'));
    expect(code(c.start(req({ deckId: 'nope' })))).toBe('not-found');
    expect(code(c.start(req({ deckId: empty.id })))).toBe('empty-deck');
    expect(code(c.start(req({ checkinMinMinutes: 0 })))).toBe('invalid-request');
    expect(code(c.start(req({ checkinMinMinutes: 10, checkinMaxMinutes: 5 })))).toBe('invalid-request');
    expect(code(c.start(req({ checkinMaxMinutes: 241 })))).toBe('invalid-request');
    expect(code(c.start(req({ topic: 'x'.repeat(81) })))).toBe('invalid-request');
    expect(c.view()).toEqual({ phase: 'idle' });
    ok(c.start(req()));
    expect(code(c.start(req()))).toBe('already-running');
  });
});

describe('active deck', () => {
  it('names the deck only while a session runs', async () => {
    const c = ctl!;
    expect(c.activeDeckId()).toBeNull();
    ok(c.start(req()));
    expect(c.activeDeckId()).toBe(deckId);
    ok(await c.end());
    expect(c.activeDeckId()).toBeNull();
  });
});

describe('the loop', () => {
  it('a card appears at the check-in and the view carries it', () => {
    const c = ctl!;
    ok(c.start(req()));
    vi.advanceTimersByTime(61_000);
    expect(running(c.view()).card).toEqual({ id: 'id2', front: 'France', back: 'Paris' });
  });

  it('answering grades the card, saves the review and clears the card', async () => {
    const c = ctl!;
    ok(c.start(req()));
    vi.advanceTimersByTime(61_000);
    ok(c.answer('good'));
    const v = running(c.view());
    expect(v).toMatchObject({ card: null, answered: 1, treats: 1 });
    await c.settled();
    expect(lib.getDeck(deckId)?.cards[0]?.fsrs.reps).toBe(1);
  });

  it('answering with no card up is refused', () => {
    const c = ctl!;
    expect(code(c.answer('good'))).toBe('not-running');
    ok(c.start(req()));
    expect(code(c.answer('good'))).toBe('invalid-request');
  });

  it('a review that cannot be saved is flagged but the session carries on', async () => {
    const c = ctl!;
    ok(c.start(req()));
    vi.advanceTimersByTime(61_000);
    ok(await lib.deleteDeck(deckId));
    ok(c.answer('good'));
    await c.settled();
    expect(running(c.view())).toMatchObject({ saveProblem: true, answered: 1 });
  });
});

describe('controls', () => {
  it('pause and resume show up in the view, and need a running session', () => {
    const c = ctl!;
    expect(code(c.control({ action: 'pause' }))).toBe('not-running');
    ok(c.start(req()));
    ok(c.control({ action: 'pause' }));
    expect(running(c.view()).paused).toBe(true);
    ok(c.control({ action: 'resume' }));
    expect(running(c.view()).paused).toBe(false);
  });

  it('a stay shows its time left, counts down, and can be cancelled', () => {
    const c = ctl!;
    ok(c.start(req()));
    ok(c.control({ action: 'stay-on', minutes: 25 }));
    expect(running(c.view())).toMatchObject({ stay: true, stayLeftMs: 25 * MIN });
    vi.advanceTimersByTime(5 * MIN);
    const left = running(c.view()).stayLeftMs!;
    expect(left).toBeLessThanOrEqual(20 * MIN);
    expect(left).toBeGreaterThan(20 * MIN - 2000);
    ok(c.control({ action: 'stay-off' }));
    expect(running(c.view())).toMatchObject({ stay: false, stayLeftMs: null });
  });

  it('only 15, 25 or 50 minutes are accepted for a stay', () => {
    const c = ctl!;
    ok(c.start(req()));
    expect(code(c.control({ action: 'stay-on', minutes: 7 as 15 }))).toBe('invalid-request');
    expect(running(c.view()).stay).toBe(false);
  });

  it('away and suppressed come from the events fed in, and survive into the next session', () => {
    const c = ctl!;
    c.dispatch({ type: 'USER_ACTIVITY', state: 'away' });
    ok(c.start(req()));
    expect(running(c.view()).away).toBe(true);
    vi.advanceTimersByTime(10 * MIN);
    expect(running(c.view()).card).toBeNull();
    c.dispatch({ type: 'USER_ACTIVITY', state: 'active' });
    c.dispatch({ type: 'SUPPRESS_CHANGED', on: true });
    expect(running(c.view())).toMatchObject({ away: false, suppressed: true });
  });
});

describe('ending', () => {
  it('ends with a summary, records it in the history, and holds the summary until dismissed', async () => {
    const c = ctl!;
    ok(c.start(req({ topic: 'Verbs' })));
    vi.advanceTimersByTime(61_000);
    ok(c.answer('good'));
    const v = ok(await c.end());
    expect(v).toMatchObject({ phase: 'ended', deckName: 'Capitals', topic: 'Verbs', answered: 1, treats: 1, saved: true, startedAt: T0, endedAt: T0 + 61_000 });
    expect(c.view()).toEqual(v);
    expect(lib.listSessions()).toEqual([expect.objectContaining({ topic: 'Verbs', answered: 1, deckId })]);
    c.dismissSummary();
    expect(c.view()).toEqual({ phase: 'idle' });
  });

  it('starting again drops a summary that was never dismissed', async () => {
    const c = ctl!;
    ok(c.start(req()));
    ok(await c.end());
    ok(c.start(req()));
    expect(c.view().phase).toBe('running');
  });

  it('ending twice, or with nothing running, is refused', async () => {
    const c = ctl!;
    expect(code(await c.end())).toBe('not-running');
    ok(c.start(req()));
    ok(await c.end());
    expect(code(await c.end())).toBe('not-running');
  });

  it('a history that cannot be written still ends the session, and says it was not saved', async () => {
    const failing = createStorage(dir, { fs: { ...nodeFs, rename: () => Promise.reject(Object.assign(new Error('disk'), { code: 'EIO' })) } });
    const bad = await createLibrary({ storage: failing });
    const c = createSessionController({ library: bad, seed: 1, publish: () => undefined });
    try {
      ok(c.start(req()));
      const v = ok(await c.end());
      expect(v).toMatchObject({ phase: 'ended', saved: false });
    } finally {
      c.dispose();
    }
  });

  it('stops ticking and refreshing once ended', async () => {
    const c = ctl!;
    ok(c.start(req()));
    ok(await c.end());
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('publishing', () => {
  it('announces the end of a session only once the history holds it', async () => {
    let rowsWhenAnnounced = -1;
    const seen: SessionView[] = [];
    const watcher = createSessionController({
      library: lib,
      seed: 3,
      publish: (v) => {
        seen.push(v);
        if (v.phase === 'ended') rowsWhenAnnounced = lib.listSessions().length;
      },
    });
    ok(watcher.start(req()));
    ok(await watcher.end());
    watcher.dispose();
    expect(seen.filter((v) => v.phase === 'ended')).toHaveLength(1);
    expect(rowsWhenAnnounced).toBe(1);
  });

  it('pushes the view when it changes, and stays quiet when it does not', () => {
    const c = ctl!;
    ok(c.start(req({ checkinMinMinutes: 60, checkinMaxMinutes: 60 })));
    const before = views.length;
    vi.advanceTimersByTime(30_000);
    expect(views.length).toBe(before);
    ok(c.control({ action: 'pause' }));
    expect(views.length).toBe(before + 1);
    expect(running(views.at(-1)!).paused).toBe(true);
  });

  it('a stay’s countdown is pushed about once a second', () => {
    const c = ctl!;
    ok(c.start(req({ checkinMinMinutes: 60, checkinMaxMinutes: 60 })));
    ok(c.control({ action: 'stay-on', minutes: 15 }));
    const before = views.length;
    vi.advanceTimersByTime(5_000);
    expect(views.length - before).toBeGreaterThanOrEqual(4);
    expect(views.length - before).toBeLessThanOrEqual(6);
  });
});
