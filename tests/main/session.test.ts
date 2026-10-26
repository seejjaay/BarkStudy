import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUILT_LINES } from '../../src/engine/lines';
import { DEFAULT_TUNING } from '../../src/engine/tuning';
import type { BubbleState } from '../../src/shared/bubble';
import type { Result, SessionView, StartRequest } from '../../src/shared/control';
import type { DisplayInfo, TrackedWindow } from '../../src/shared/geometry';
import type { DogFrame, SpeechLine } from '../../src/shared/ipc';
import type { SoundName } from '../../src/shared/sounds';
import { createDogHost, type DogAction, type DogHost } from '../../src/main/dogHost';
import { createEscapeKey, type EscapeKey } from '../../src/main/escapeKey';
import { createLibrary, type Library } from '../../src/main/library';
import { createSessionController, type SessionController, type SessionControllerOptions } from '../../src/main/session';
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

describe('the bubble', () => {
  let bubbles: (BubbleState | null)[];
  let c: SessionController;
  beforeEach(() => {
    bubbles = [];
    ctl?.dispose();
    c = createSessionController({ library: lib, seed: 11, publish: (v) => views.push(v), publishBubble: (b) => bubbles.push(b) });
    ctl = c;
  });
  const up = () => {
    ok(c.start(req()));
    vi.advanceTimersByTime(61_000);
  };

  it('opens with the front of the card, and nothing before there is one', () => {
    ok(c.start(req()));
    expect(c.bubbleState()).toBeNull();
    vi.advanceTimersByTime(61_000);
    expect(c.bubbleState()).toEqual({ cardId: 'id2', front: 'France', open: true });
    expect(bubbles.at(-1)).toEqual({ cardId: 'id2', front: 'France', open: true });
  });

  it('never carries the answer in what it publishes', () => {
    up();
    expect(JSON.stringify(bubbles)).not.toContain('Paris');
  });

  it('Esc dismisses it without answering; the card stays pending and opening brings it back', () => {
    up();
    c.dismissBubble();
    expect(c.bubbleState()).toMatchObject({ open: false });
    expect(running(c.view())).toMatchObject({ answered: 0, card: { front: 'France' } });
    c.openBubble();
    expect(c.bubbleState()).toMatchObject({ open: true });
  });

  it('a later re-ask of the same card reopens a dismissed bubble', () => {
    up();
    c.dismissBubble();
    vi.advanceTimersByTime(30 * MIN);
    expect(c.bubbleState()?.open).toBe(true);
  });

  it('opening with no card does nothing', () => {
    ok(c.start(req()));
    c.openBubble();
    expect(c.bubbleState()).toBeNull();
  });

  it.each([
    ['Paris', 'exact', 'good', 1],
    ['  paris ', 'exact', 'good', 1],
    ['Pariss', 'fuzzy', 'hard', 1],
    ['London', 'wrong', 'again', 0],
  ] as const)('typing %j is %s, graded %s, and %i treat(s)', async (typed, match, _grade, treats) => {
    up();
    expect(c.submitText(typed)).toEqual({ ok: true, match, expected: 'Paris' });
    expect(running(c.view())).toMatchObject({ answered: 1, treats, card: null });
    expect(c.bubbleState()).toBeNull();
    await c.settled();
    const card = lib.getDeck(deckId)!.cards[0]!;
    expect(card.fsrs.reps).toBe(1);
  });

  it('a typed fuzzy match is saved as Hard and a wrong one as Again', async () => {
    up();
    c.submitText('Pariss');
    await c.settled();
    const hard = lib.getDeck(deckId)!.cards[0]!.fsrs;
    vi.advanceTimersByTime(5 * MIN);
    c.dispatch({ type: 'CHECKIN_DUE' });
    c.submitText('Cusco');
    await c.settled();
    const second = lib.getDeck(deckId)!.cards[1]!.fsrs;
    expect(hard.stability).toBeGreaterThan(second.stability);
  });

  it('an empty or blank answer is not an answer', () => {
    up();
    expect(c.submitText('')).toEqual({ ok: false });
    expect(c.submitText('   ')).toEqual({ ok: false });
    expect(running(c.view()).answered).toBe(0);
  });

  it('typing with no card up is refused', () => {
    ok(c.start(req()));
    expect(c.submitText('Paris')).toEqual({ ok: false });
  });

  it('reveal gives the back only when asked, and self-grading counts as an answer', () => {
    up();
    expect(c.revealAnswer()).toEqual({ ok: true, back: 'Paris' });
    expect(c.selfGrade('again')).toBe(true);
    expect(running(c.view())).toMatchObject({ answered: 1, treats: 0, card: null });
    expect(c.selfGrade('good')).toBe(false);
    expect(c.revealAnswer()).toEqual({ ok: false });
  });

  it('answering from the control window closes the bubble too', () => {
    up();
    ok(c.answer('good'));
    expect(c.bubbleState()).toBeNull();
    expect(bubbles.at(-1)).toBeNull();
  });

  it('ending the session closes it', async () => {
    up();
    ok(await c.end());
    expect(c.bubbleState()).toBeNull();
    expect(bubbles.at(-1)).toBeNull();
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

// ---------------------------------------------------------------------------------------------------------------------
// The presentation: what the session drives outward from the engine's actions (the dog, the Esc key, speech and sound).

type Presentation = NonNullable<SessionControllerOptions['presentation']>;

const DISPLAY: DisplayInfo = { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 824 }, scaleFactor: 1 };
const WINDOW: TrackedWindow = { id: 42, bounds: { x: 300, y: 300, width: 400, height: 300 }, z: 0, processName: 'a.exe', isForeground: true, fullscreen: false };

const describeAction = (a: DogAction): string => (a.type === 'END_EFFECT' || a.type === 'CURL_UP' ? `perform:${a.type}` : `perform:${a.type}:${a.windowId}`);

/** Every call the session makes outward, in order, with the fake time it was made at. */
function recordPresentation() {
  const log: { what: string; at: number }[] = [];
  const lines: SpeechLine[] = [];
  const sounds: { name: SoundName; volume: number }[] = [];
  const note = (what: string) => log.push({ what, at: Date.now() });
  const presentation: Presentation = {
    dog: {
      perform: (a) => note(describeAction(a)),
      setMood: (name) => note(`mood:${name}`),
      sulkAfter: () => note('sulkAfter'),
      setStay: (on) => note(`stay:${on ? 'on' : 'off'}`),
      wake: () => note('wake'),
    },
    escape: {
      effectStarted: (maxMs) => note(`escape:held:${maxMs}`),
      effectEnded: () => note('escape:released'),
    },
    speech: (line) => {
      lines.push(line);
      note(`say:${line.key}`);
    },
    sound: (name, volume) => {
      sounds.push({ name, volume });
      note(`sound:${name}`);
    },
  };
  return { log, lines, sounds, presentation, whats: (from = 0) => log.slice(from).map((e) => e.what) };
}

/** A stand-in for Electron's globalShortcut: what is registered, and the callback a press would run. */
function fakeHotkeys() {
  const held = new Map<string, () => void>();
  return {
    held,
    hotkeys: {
      register: (accelerator: string, onPress: () => void) => {
        if (held.has(accelerator)) return false;
        held.set(accelerator, onPress);
        return true;
      },
      unregister: (accelerator: string) => void held.delete(accelerator),
    },
  };
}

/** Moves fake time on in small steps until `done()` holds; fails the test if it never does within `maxMs`. */
function until(done: () => boolean, maxMs: number, stepMs = 250): void {
  for (let t = 0; !done(); t += stepMs) {
    if (t > maxMs) throw new Error(`not reached within ${maxMs} ms`);
    vi.advanceTimersByTime(stepMs);
  }
}

describe('what the session drives outward', () => {
  // With seed 11 and the classic preset, an ignored card on a known window runs laps at level 3, then dig-in at level 4.
  let rec: ReturnType<typeof recordPresentation>;
  let bubbles: (BubbleState | null)[];
  let c: SessionController;
  const make = (over: Partial<SessionControllerOptions> = {}): SessionController => {
    ctl?.dispose();
    c = createSessionController({ library: lib, seed: 11, publish: (v) => views.push(v), publishBubble: (b) => bubbles.push(b), presentation: rec.presentation, ...over });
    ctl = c;
    return c;
  };
  const has = (what: string, from = 0) => rec.whats(from).includes(what);
  const cardUp = () => c.view().phase === 'running' && running(c.view()).card !== null;
  const moods = () => rec.whats().filter((w) => w.startsWith('mood:'));
  const stays = () => rec.whats().filter((w) => w.startsWith('stay:'));

  /** A real dog behind the session (on a known window, not roaming), his last frame, and how often he has read the cursor. */
  function realDog() {
    const seen: { frame: DogFrame | null; cursorReads: number } = { frame: null, cursorReads: 0 };
    const dog: DogHost = createDogHost({
      seed: 5,
      sink: { send: (_id, f) => void (f && (seen.frame = f)) },
      cursor: () => {
        seen.cursorReads++;
        return { x: 0, y: 0 };
      },
      onEffectLost: () => c.effectLost(),
    });
    dog.setRoaming(false);
    dog.setWorld([WINDOW], [DISPLAY]);
    make({ presentation: { dog, speech: rec.presentation.speech, sound: rec.presentation.sound } });
    return { dog, seen };
  }

  beforeEach(() => {
    rec = recordPresentation();
    bubbles = [];
    make();
  });

  it('engine effect actions reach the dog; RUN_LAPS and START_DIG_IN hold Esc for their real max, and END_EFFECT releases it', () => {
    ok(c.start(req()));
    c.setActiveWindow(42);
    until(() => has('perform:RUN_LAPS:42'), 10 * MIN);
    const laps = rec.whats().indexOf('perform:RUN_LAPS:42');
    expect(rec.whats(laps).slice(0, 3)).toEqual(['perform:RUN_LAPS:42', `escape:held:${DEFAULT_TUNING.lapsMaxMs}`, 'sound:bark']);
    until(() => has('perform:END_EFFECT', laps), DEFAULT_TUNING.lapsMaxMs + 1000);
    const lapsEnd = rec.whats().indexOf('perform:END_EFFECT', laps);
    expect(rec.whats(lapsEnd).slice(0, 2)).toEqual(['perform:END_EFFECT', 'escape:released']);

    until(() => has('perform:START_DIG_IN:42'), 5 * MIN);
    const dig = rec.whats().indexOf('perform:START_DIG_IN:42');
    expect(rec.whats(dig).slice(0, 3)).toEqual(['perform:START_DIG_IN:42', `escape:held:${DEFAULT_TUNING.digInMaxMs}`, 'sound:scratch']);
    until(() => has('perform:END_EFFECT', dig), DEFAULT_TUNING.digInMaxMs + 1000);
    expect(rec.whats(rec.whats().indexOf('perform:END_EFFECT', dig)).slice(0, 2)).toEqual(['perform:END_EFFECT', 'escape:released']);
    expect(moods()).toEqual(expect.arrayContaining(['mood:curious', 'mood:zoomies', 'mood:dig']));
  });

  it('moods reach the dog and the sound gate: a whine plays whine at the settings volume', async () => {
    ok(await lib.updateSettings({ volume: 0.65 }));
    ok(c.start(req())); // no window to run round, so the escalation is pleas and whines
    until(() => has('mood:whine'), 10 * MIN);
    expect(moods()[0]).toBe('mood:curious');
    expect(rec.sounds).toContainEqual({ name: 'whine', volume: 0.65 });
    expect(rec.sounds.every((s) => s.name === 'whine')).toBe(true);
  });

  it('a happy answer yips; with sound off, or while paused, nothing plays', async () => {
    ok(c.start(req()));
    until(cardUp, 2 * MIN);
    ok(c.answer('good'));
    expect(moods().at(-1)).toMatch(/^mood:(happy|ecstatic)$/);
    expect(rec.sounds).toEqual([{ name: 'yip', volume: 0.4 }]);

    vi.advanceTimersByTime(10_000); // past the gap between sounds
    until(cardUp, 2 * MIN);
    ok(c.control({ action: 'pause' }));
    ok(c.answer('good'));
    expect(moods().at(-1)).toMatch(/^mood:(happy|ecstatic)$/);
    expect(rec.sounds).toHaveLength(1);

    ok(c.control({ action: 'resume' }));
    ok(await lib.updateSettings({ soundOn: false }));
    const from = rec.log.length;
    until(() => has('mood:whine', from), 10 * MIN);
    expect(rec.sounds).toHaveLength(1);
  });

  it('an answer with a guilt trip calls sulkAfter after the answer’s mood, and the guilt line passes the speech gate with its minutes', () => {
    ok(c.start(req()));
    until(cardUp, 2 * MIN);
    const cardAt = Date.now();
    until(() => Date.now() - cardAt >= 2 * MIN, 3 * MIN);
    // Answer straight after an escalation line, while any ordinary line would still be held back by the gate.
    const said = rec.lines.length;
    until(() => rec.lines.length > said, 2 * MIN);
    const from = rec.log.length;
    ok(c.answer('good'));
    const after = rec.whats(from);
    const mood = after.findIndex((w) => w === 'mood:happy' || w === 'mood:ecstatic');
    expect(mood).toBeGreaterThan(-1);
    expect(after.indexOf('sulkAfter')).toBeGreaterThan(mood);
    const line = rec.lines.at(-1)!;
    expect(GUILT_LINES).toContain(line.key);
    expect(line.params?.['minutes']).toBeGreaterThanOrEqual(2);
    expect(new Set(rec.lines.map((l) => l.id)).size).toBe(rec.lines.length);
  });

  it('a quick answer gets its mood and no sulk', () => {
    ok(c.start(req()));
    until(cardUp, 2 * MIN);
    ok(c.answer('good'));
    expect(rec.whats()).not.toContain('sulkAfter');
    expect(GUILT_LINES).not.toContain(rec.lines.at(-1)?.key);
  });

  it('a dig that ends with the card still pending reopens the bubble', () => {
    ok(c.start(req()));
    c.setActiveWindow(42);
    until(() => has('perform:START_DIG_IN:42'), 10 * MIN);
    const dig = rec.log.length;
    c.dismissBubble();
    expect(c.bubbleState()?.open).toBe(false);
    until(() => has('perform:END_EFFECT', dig), DEFAULT_TUNING.digInMaxMs + 1000);
    expect(c.bubbleState()?.open).toBe(true);
    expect(bubbles.at(-1)?.open).toBe(true);
  });

  it('a dig that Leave it ends does not bring the bubble back', () => {
    ok(c.start(req()));
    c.setActiveWindow(42);
    until(() => has('perform:START_DIG_IN:42'), 10 * MIN);
    c.dismissBubble();
    ok(c.control({ action: 'pause' }));
    expect(rec.whats().at(-1)).toBe('escape:released');
    expect(c.bubbleState()?.open).toBe(false);
  });

  it('effectLost dispatches ESC_PRESSED: the effect ends and the level is kept', () => {
    ok(c.start(req()));
    c.setActiveWindow(42);
    until(() => has('perform:RUN_LAPS:42'), 10 * MIN);
    const from = rec.log.length;
    c.effectLost();
    expect(rec.whats(from)).toEqual(['perform:END_EFFECT', 'escape:released']);
    expect(cardUp()).toBe(true);
    c.effectLost(); // a late report with nothing running changes nothing
    expect(rec.log.length).toBe(from + 2);
    // Laps were level 3; the next step is still level 4's dig-in, not a fresh start at the bottom of the ladder.
    until(() => has('perform:START_DIG_IN:42', from), 2 * MIN);
  });

  it('stay on and off reach the dog, including a stay that runs out and a session that ends during one', async () => {
    ok(c.start(req()));
    ok(c.control({ action: 'stay-on', minutes: 15 }));
    expect(stays()).toEqual(['stay:on']);
    vi.advanceTimersByTime(5_000); // the view refreshes, and the dog is not told again
    ok(c.control({ action: 'stay-off' }));
    expect(stays()).toEqual(['stay:on', 'stay:off']);
    ok(c.control({ action: 'stay-on', minutes: 15 }));
    vi.advanceTimersByTime(15 * MIN + 2_000);
    expect(stays()).toEqual(['stay:on', 'stay:off', 'stay:on', 'stay:off']);
    ok(c.control({ action: 'stay-on', minutes: 15 }));
    const ending = c.end();
    expect(stays().at(-1)).toBe('stay:off');
    ok(await ending);
  });

  it('Review Focus 4: Esc during an effect while the bubble is open ends the effect and leaves the bubble open; the second Esc dismisses it', () => {
    const keys = fakeHotkeys();
    const escape: EscapeKey = createEscapeKey({ hotkeys: keys.hotkeys, onPress: () => c.dispatch({ type: 'ESC_PRESSED' }) });
    make({ presentation: { ...rec.presentation, escape } });
    try {
      ok(c.start(req()));
      c.setActiveWindow(42);
      until(() => escape.held, 10 * MIN);
      expect(c.bubbleState()?.open).toBe(true); // the user is typing in it
      const from = rec.log.length;
      keys.held.get('Escape')!();
      expect(escape.held).toBe(false);
      expect(keys.held.has('Escape')).toBe(false);
      expect(rec.whats(from)).toContain('perform:END_EFFECT');
      expect(c.bubbleState()?.open).toBe(true);
      // Esc is no longer global, so the next press reaches the focused bubble, which dismisses itself.
      c.dismissBubble();
      expect(c.bubbleState()?.open).toBe(false);
      expect(running(c.view())).toMatchObject({ answered: 0, card: { front: 'France' } });
    } finally {
      escape.dispose();
    }
  });

  it.each(['pause', 'end'] as const)(
    'Review Focus 5: %s mid-effect releases Esc at once, returns him to roaming, and plays no more sound or speech',
    async (how) => {
      const keys = fakeHotkeys();
      const seen: { frame: DogFrame | null } = { frame: null };
      const dog: DogHost = createDogHost({ seed: 5, sink: { send: (_id, f) => void (f && (seen.frame = f)) }, onEffectLost: () => c.effectLost() });
      dog.setRoaming(false);
      dog.setWorld([WINDOW], [DISPLAY]);
      const escape = createEscapeKey({ hotkeys: keys.hotkeys, onPress: () => c.dispatch({ type: 'ESC_PRESSED' }) });
      make({ presentation: { dog, escape, speech: rec.presentation.speech, sound: rec.presentation.sound } });
      try {
        ok(c.start(req()));
        c.setActiveWindow(WINDOW.id);
        until(() => dog.behaviour === 'laps' || dog.behaviour === 'dig', 10 * MIN);
        expect(escape.held).toBe(true);
        expect(seen.frame?.effect).toBeDefined();
        const said = rec.lines.length;
        const played = rec.sounds.length;

        if (how === 'pause') ok(c.control({ action: 'pause' })); // what Leave it does
        const ending = how === 'end' ? c.end() : null;
        expect(escape.held).toBe(false);
        expect(keys.held.has('Escape')).toBe(false);
        expect(dog.behaviour).toBe('roam');
        if (ending) ok(await ending);

        vi.advanceTimersByTime(10 * MIN);
        expect(rec.lines).toHaveLength(said);
        expect(rec.sounds).toHaveLength(played);
        expect(seen.frame?.effect).toBeUndefined();
        expect(dog.behaviour).toBe('roam');
        expect(escape.held).toBe(false);
      } finally {
        dog.dispose();
        escape.dispose();
      }
    },
  );

  it.each(['comes back', 'closes the app that suppressed him', 'ends the session'] as const)(
    'away, then back: he curls up while the user is gone, and gets up to roam when the user %s',
    async (how) => {
      const { dog, seen } = realDog();
      try {
        ok(c.start(req()));
        if (how === 'closes the app that suppressed him') {
          // A card goes unanswered while Zoom is in front: its timeout curls him up instead of escalating.
          until(cardUp, 2 * MIN);
          c.dispatch({ type: 'SUPPRESS_CHANGED', on: true });
          until(() => dog.behaviour === 'curl', 5 * MIN);
        } else {
          c.dispatch({ type: 'USER_ACTIVITY', state: 'away' });
        }
        expect(dog.behaviour).toBe('curl');
        expect(seen.frame?.pose).toBe('curl');

        if (how === 'comes back') c.dispatch({ type: 'USER_ACTIVITY', state: 'active' });
        else if (how === 'closes the app that suppressed him') c.dispatch({ type: 'SUPPRESS_CHANGED', on: false });
        else ok(await c.end());
        expect(dog.behaviour).toBe('roam');
        expect(seen.frame?.pose).not.toBe('curl');
      } finally {
        dog.dispose();
      }
    },
  );

  it('he stays curled up while the user is still away or Zoom is still in front', () => {
    const { dog } = realDog();
    try {
      ok(c.start(req()));
      c.dispatch({ type: 'USER_ACTIVITY', state: 'away' });
      c.dispatch({ type: 'SUPPRESS_CHANGED', on: true });
      c.dispatch({ type: 'USER_ACTIVITY', state: 'active' }); // back, but Zoom is in front
      expect(dog.behaviour).toBe('curl');
      c.dispatch({ type: 'SUPPRESS_CHANGED', on: false });
      expect(dog.behaviour).toBe('roam');
    } finally {
      dog.dispose();
    }
  });

  it('fastTuning shrinks check-in, escalation and guilt timings 100× and leaves effect durations', () => {
    make({ fastTuning: true });
    ok(c.start(req())); // a check-in every minute: 600 ms
    c.setActiveWindow(42);
    vi.advanceTimersByTime(1000);
    expect(cardUp()).toBe(true);
    const atCard = moods().length;
    vi.advanceTimersByTime(1000); // the first escalation (a timeout) is 90 s for classic patience: 900 ms
    expect(moods().length).toBeGreaterThan(atCard);

    // Effects keep their real length: the engine's own END_EFFECT comes the real max after the last effect began.
    until(() => has('perform:END_EFFECT'), 30_000, 50);
    const end = rec.log.find((e) => e.what === 'perform:END_EFFECT')!;
    const began = rec.log.filter((e) => e.what.startsWith('escape:held:') && e.at <= end.at).at(-1)!;
    const maxMs = Number(began.what.split(':')[2]);
    expect([DEFAULT_TUNING.lapsMaxMs, DEFAULT_TUNING.digInMaxMs]).toContain(maxMs);
    expect(end.at - began.at).toBeGreaterThanOrEqual(maxMs - 250);
    expect(end.at - began.at).toBeLessThanOrEqual(maxMs + 250);

    // Waiting a few seconds is already over the guilt threshold (2 min / 100).
    ok(c.answer('good'));
    expect(rec.whats()).toContain('sulkAfter');
    expect(GUILT_LINES).toContain(rec.lines.at(-1)?.key);
    // Lines still keep their real 30 s gap: only the card's own line and the guilt line got through.
    expect(rec.lines).toHaveLength(2);
  });
});
