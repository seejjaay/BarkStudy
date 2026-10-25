import { createEngine, step, type EngineState } from '../engine/engine';
import { DEFAULT_TUNING, TRAIT_PRESETS, type TraitPreset } from '../engine/tuning';
import type { Action, Activity, Cap, Context, Event } from '../engine/types';
import type { GuiltTripRecord, Card } from '../shared/model';
import { nextCard, review, type Grade } from '../shared/srs';
import type { Clock } from './dogHost';

/**
 * Runs the engine for the app: owns its state, ticks it while a session runs, turns its actions into calls on a sink
 * (the bubble, the dog, the treat counter), picks the card to ask, and keeps a small log of what it was fed.
 * No Electron in here; the sink and the clock are injected.
 */

export const HOST_TICK_MS = 250;
const DEFAULT_LOG_CAPACITY = 500;

/** What the bubble needs. `back` stays in the main process's hands only until the bubble asks to reveal it. */
export interface CardPrompt {
  id: string;
  front: string;
  back: string;
}

type EffectAction = Extract<Action, { type: 'RUN_LAPS' | 'START_DIG_IN' | 'END_EFFECT' | 'CURL_UP' }>;

export interface HostSink {
  showCard: (card: CardPrompt) => void;
  hideCard: () => void;
  /** `line` is an i18n key, not display text. */
  say: (line: string, params?: Record<string, number>) => void;
  expression: (name: string) => void;
  walkTo: (windowId: number) => void;
  effect: (action: EffectAction) => void;
  treat: () => void;
}

export interface StartOptions {
  cards: readonly Card[];
  cap: Cap;
  preset: TraitPreset;
  /** Check-ins are spaced between these bounds. */
  checkinMinMinutes: number;
  checkinMaxMinutes: number;
  /** How long the last guilt trip of an earlier session waited, for the greeting. */
  lastGuiltMs?: number | null;
}

export interface SessionSummary {
  startedAt: number;
  endedAt: number;
  answered: number;
  treats: number;
  longestWaitMs: number;
  guiltTrips: GuiltTripRecord[];
}

/** Events other parts of the app may send. The host itself owns the session boundary, the clock and answers. */
export type ExternalEvent = Exclude<Event, { type: 'SESSION_START' | 'SESSION_END' | 'TICK' | 'ANSWER_SUBMITTED' }>;

export interface LogEntry {
  type: Event['type'];
  at: number;
  /** TICK only: total time covered by the merged ticks. */
  dtMs?: number;
  /** TICK only: how many ticks were merged. */
  count?: number;
  /** A short non-sensitive value: the activity state, the cap, whether an answer was right. */
  detail?: string;
}

export interface Diagnostics {
  seed: number;
  entries: readonly LogEntry[];
}

export interface EngineHost {
  /** Throws on an empty deck or if a session is already running. */
  start: (opts: StartOptions) => void;
  /** Throws if no session is running. */
  end: () => SessionSummary;
  /** Grades the card on screen. False if there is none. */
  answer: (grade: Grade) => boolean;
  dispatch: (e: ExternalEvent) => void;
  setBusy: (busy: boolean) => void;
  /** The window the dog may go to, or null. */
  setActiveWindow: (id: number | null) => void;
  setPreset: (preset: TraitPreset) => void;
  readonly running: boolean;
  diagnostics: () => Diagnostics;
  dispose: () => void;
}

export interface EngineHostOptions {
  seed: number;
  sink: HostSink;
  clock?: Clock;
  /** Called with each card right after it is graded, so a crash loses at most one review. */
  onReviewed?: (card: Card) => void;
  logCapacity?: number;
}

const defaultClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const freshStats = (): EngineState['stats'] => ({ answered: 0, treats: 0, cardShownAt: null, longestWaitMs: 0, guiltTrips: [] });

function detailOf(e: Event): string | undefined {
  switch (e.type) {
    case 'USER_ACTIVITY':
      return e.state;
    case 'SUPPRESS_CHANGED':
      return e.on ? 'on' : 'off';
    case 'ANSWER_SUBMITTED':
      return e.correct ? 'correct' : 'missed';
    case 'SESSION_START':
    case 'CAP_CHANGED':
      return String(e.cap);
    default:
      return undefined;
  }
}

export function createEngineHost(opts: EngineHostOptions): EngineHost {
  const clock = opts.clock ?? defaultClock;
  const capacity = opts.logCapacity ?? DEFAULT_LOG_CAPACITY;
  const { sink } = opts;

  let state = createEngine(opts.seed);
  let running = false;
  let handle: unknown = null;
  let lastTickAt = 0;
  let startedAt = 0;

  let cards: Card[] = [];
  let current: Card | null = null;
  let guiltTrips: GuiltTripRecord[] = [];

  let ctx: Context = {
    traits: TRAIT_PRESETS.classic,
    tuning: DEFAULT_TUNING,
    activeWindowId: null,
    busy: false,
    lastGuiltMs: null,
  };

  // The rule layer forgets these at a session boundary, but the user's screen does not.
  let activity: Activity = 'active';
  let suppressed = false;

  const log: LogEntry[] = [];
  function record(e: Event): void {
    const at = clock.now();
    const last = log.at(-1);
    if (e.type === 'TICK' && last?.type === 'TICK') {
      last.dtMs = (last.dtMs ?? 0) + e.dtMs;
      last.count = (last.count ?? 1) + 1;
      last.at = at;
      return;
    }
    const entry: LogEntry = { type: e.type, at };
    const detail = detailOf(e);
    if (detail !== undefined) entry.detail = detail;
    if (e.type === 'TICK') Object.assign(entry, { dtMs: e.dtMs, count: 1 });
    log.push(entry);
    while (log.length > capacity) log.shift();
  }

  function route(actions: readonly Action[]): void {
    for (const a of actions) {
      switch (a.type) {
        case 'SHOW_FLASHCARD':
          current ??= nextCard({ cards }, clock.now());
          if (current) sink.showCard({ id: current.id, front: current.front, back: current.back });
          break;
        case 'SET_EXPRESSION':
          sink.expression(a.name);
          break;
        case 'WALK_TO':
          sink.walkTo(a.windowId);
          break;
        case 'RUN_LAPS':
        case 'START_DIG_IN':
        case 'END_EFFECT':
        case 'CURL_UP':
          sink.effect(a);
          break;
        case 'SAY':
          if (a.params) sink.say(a.line, a.params);
          else sink.say(a.line);
          break;
        case 'AWARD_TREAT':
          sink.treat();
          break;
        case 'RECORD_GUILT_TRIP':
          guiltTrips = [...guiltTrips, { at: clock.now(), waitedMs: a.waitedMs }];
          ctx = { ...ctx, lastGuiltMs: a.waitedMs };
          break;
      }
    }
  }

  function apply(e: Event): void {
    record(e);
    const hadCard = state.rules.card;
    const r = step(state, e, ctx);
    state = r.state;
    route(r.actions);
    if (hadCard && !state.rules.card) {
      current = null;
      sink.hideCard();
    }
  }

  function scheduleTick(): void {
    handle = clock.setTimeout(onTick, HOST_TICK_MS);
  }

  function onTick(): void {
    const t = clock.now();
    const dtMs = t - lastTickAt;
    lastTickAt = t;
    apply({ type: 'TICK', dtMs });
    if (running) scheduleTick();
  }

  function stopTicking(): void {
    if (handle !== null) clock.clearTimeout(handle);
    handle = null;
  }

  return {
    start(o) {
      if (running) throw new Error('a session is already running');
      if (o.cards.length === 0) throw new Error('the deck has no cards');
      cards = [...o.cards];
      current = null;
      guiltTrips = [];
      ctx = {
        ...ctx,
        traits: TRAIT_PRESETS[o.preset],
        tuning: { ...DEFAULT_TUNING, checkinMinMs: o.checkinMinMinutes * 60_000, checkinMaxMs: o.checkinMaxMinutes * 60_000 },
        lastGuiltMs: o.lastGuiltMs ?? null,
      };
      state = { ...state, stats: freshStats() };
      running = true;
      startedAt = clock.now();
      lastTickAt = startedAt;
      apply({ type: 'SESSION_START', cap: o.cap });
      if (activity !== 'active') apply({ type: 'USER_ACTIVITY', state: activity });
      if (suppressed) apply({ type: 'SUPPRESS_CHANGED', on: true });
      scheduleTick();
    },

    end() {
      if (!running) throw new Error('no session is running');
      stopTicking();
      running = false;
      apply({ type: 'SESSION_END' });
      current = null;
      const { stats } = state;
      return {
        startedAt,
        endedAt: clock.now(),
        answered: stats.answered,
        treats: stats.treats,
        longestWaitMs: stats.longestWaitMs,
        guiltTrips,
      };
    },

    answer(grade) {
      if (!running || !state.rules.card || !current) return false;
      const reviewed = review(current, grade, clock.now());
      cards = cards.map((c) => (c.id === reviewed.id ? reviewed : c));
      opts.onReviewed?.(reviewed);
      apply({ type: 'ANSWER_SUBMITTED', correct: grade !== 'again' });
      return true;
    },

    dispatch(e) {
      if (e.type === 'USER_ACTIVITY') activity = e.state;
      if (e.type === 'SUPPRESS_CHANGED') suppressed = e.on;
      if (running) apply(e);
    },

    setBusy(busy) {
      ctx = { ...ctx, busy };
    },
    setActiveWindow(id) {
      ctx = { ...ctx, activeWindowId: id };
    },
    setPreset(preset) {
      ctx = { ...ctx, traits: TRAIT_PRESETS[preset] };
    },

    get running() {
      return running;
    },
    diagnostics: () => ({ seed: opts.seed, entries: log.map((e) => ({ ...e })) }),
    dispose() {
      stopTicking();
      running = false;
    },
  };
}
