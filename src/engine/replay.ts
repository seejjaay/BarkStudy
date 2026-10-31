import { NO_DEADLINES } from './clock';
import { step, type EngineState, type TraceEntry } from './engine';
import { INVARIANTS } from './invariants';
import { DEFAULT_TUNING, TRAIT_PRESETS, type TraitPreset } from './tuning';
import type { Action, Cap, Context, Event, Tuning } from './types';

/**
 * The engine host's per-session log, and a replay of it: the same start state, context and events through `step`,
 * so a log taken from a user's machine reproduces the exact actions their dog took. Card text never gets in here.
 */

/** The info-string of the fenced block a diagnostics bundle carries the log in. */
export const ENGINE_LOG_FENCE = 'barkstudy-engine-log';

/** Context changes the host saw. They are not engine events, but replay needs them. */
type NoteType = 'BUSY' | 'WINDOW' | 'PRESET';

export interface LogEntry {
  type: Event['type'] | NoteType;
  /** Host wall-clock time of the entry (of the last tick, for merged ticks). Informational; replay does not use it. */
  at: number;
  /**
   * A short non-sensitive value: the cap, the activity state, on/off, whether an answer was right, the preset name.
   * WINDOW is only whether there is a window to go to; its id is not kept, so replay reports every window as 1.
   */
  detail?: string;
  /** TICK only: total time covered by the merged ticks. */
  dtMs?: number;
  /** TICK only: how many ticks were merged. */
  count?: number;
  /** STAY_ON only. */
  durationMs?: number;
}

export interface EngineLog {
  version: 1;
  seed: number;
  preset: TraitPreset;
  tuning: Tuning;
  lastGuiltMs: number | null;
  /** The engine state SESSION_START was applied to. State, the RNG included, carries over between sessions. */
  startState: EngineState;
  /** The session outgrew the log; entries are its start only. */
  truncated: boolean;
  entries: LogEntry[];
}

export interface ReplayStep {
  event: Event | null;
  ctxPatch: Partial<Context> | null;
}

/** A merged tick's ticks, in whole milliseconds when the total is whole so the engine clock lands exactly. */
function splitTick(dtMs: number, count: number): number[] {
  if (!Number.isInteger(dtMs)) return Array.from({ length: count }, () => dtMs / count);
  const base = Math.floor(dtMs / count);
  const extra = dtMs - base * count;
  return Array.from({ length: count }, (_, i) => (i < extra ? base + 1 : base));
}

function eventOf(e: LogEntry): Event {
  switch (e.type) {
    case 'SESSION_START':
    case 'CAP_CHANGED':
      return { type: e.type, cap: Number(e.detail) as Cap };
    case 'USER_ACTIVITY':
      return { type: e.type, state: e.detail === 'away' || e.detail === 'locked' ? e.detail : 'active' };
    case 'SUPPRESS_CHANGED':
      return { type: e.type, on: e.detail === 'on' };
    case 'ANSWER_SUBMITTED':
      return { type: e.type, correct: e.detail === 'correct' };
    case 'STAY_ON':
      return { type: e.type, durationMs: e.durationMs ?? 0 };
    case 'TICK':
      return { type: e.type, dtMs: e.dtMs ?? 0 };
    // The engine ignores focus changes; the window that matters comes in through WINDOW notes.
    case 'WINDOW_FOCUS_CHANGED':
      return { type: e.type, windowId: null };
    case 'BUSY':
    case 'WINDOW':
    case 'PRESET':
      throw new Error(`${e.type} is not an engine event`);
    default:
      return { type: e.type };
  }
}

function patchOf(e: LogEntry & { type: NoteType }): Partial<Context> {
  switch (e.type) {
    case 'BUSY':
      return { busy: e.detail === 'on' };
    case 'WINDOW':
      return { activeWindowId: e.detail === 'on' ? 1 : null };
    case 'PRESET':
      return { traits: TRAIT_PRESETS[e.detail as TraitPreset] };
  }
}

const isNote = (e: LogEntry): e is LogEntry & { type: NoteType } => e.type === 'BUSY' || e.type === 'WINDOW' || e.type === 'PRESET';

/** One step per engine event or context note. A merged tick expands to its `count` ticks. */
export function toEvents(log: EngineLog): ReplayStep[] {
  const out: ReplayStep[] = [];
  for (const e of log.entries) {
    if (isNote(e)) out.push({ event: null, ctxPatch: patchOf(e) });
    else if (e.type !== 'TICK') out.push({ event: eventOf(e), ctxPatch: null });
    else for (const dtMs of splitTick(e.dtMs ?? 0, e.count ?? 1)) out.push({ event: { type: 'TICK', dtMs }, ctxPatch: null });
  }
  return out;
}

/**
 * Replays a log. `actions[i]` is what step i of `toEvents(log)` emitted (empty for a context note). `violation` is the
 * first rule transition, including ones the clock fires inside a tick, that breaks an invariant.
 */
export function replayLog(log: EngineLog): { actions: Action[][]; violation: { step: number; invariant: string } | null } {
  let state = log.startState;
  let ctx: Context = {
    traits: TRAIT_PRESETS[log.preset],
    tuning: log.tuning,
    activeWindowId: null,
    busy: false,
    lastGuiltMs: log.lastGuiltMs,
  };
  const actions: Action[][] = [];
  let violation: { step: number; invariant: string } | null = null;

  toEvents(log).forEach(({ event, ctxPatch }, i) => {
    if (ctxPatch) ctx = { ...ctx, ...ctxPatch };
    if (!event) {
      actions.push([]);
      return;
    }
    const trace: TraceEntry[] = [];
    const r = step(state, event, ctx, trace);
    state = r.state;
    actions.push(r.actions);
    // The host remembers the latest guilt trip for a greeting later in the same session.
    for (const a of r.actions) if (a.type === 'RECORD_GUILT_TRIP') ctx = { ...ctx, lastGuiltMs: a.waitedMs };
    for (const t of trace) {
      if (violation) break;
      const broken = INVARIANTS.find((inv) => !inv.holds(t));
      if (broken) violation = { step: i, invariant: broken.id };
    }
  });
  return { actions, violation };
}

// --- reading a log back out of a bundle -------------------------------------------------------------------------

/** Far past any real session (about six days of ticks), so a hostile log cannot make replay allocate without bound. */
const MAX_TICKS = 2_000_000;
const MAX_ENTRIES = 100_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const oneOf = (v: unknown, options: readonly string[]): boolean => typeof v === 'string' && options.includes(v);

const CAPS = ['2', '3', '4'];
const ON_OFF = ['on', 'off'];
const ACTIVITIES = ['active', 'away', 'locked'];
const SIMPLE_EVENTS = ['SESSION_END', 'CHECKIN_DUE', 'CHECKIN_TIMEOUT', 'STAY_OFF', 'PAUSE', 'RESUME', 'ESC_PRESSED', 'WINDOW_FOCUS_CHANGED'];

function validRules(v: unknown): boolean {
  if (!isObj(v)) return false;
  const flags = ['session', 'paused', 'stay', 'suppressed', 'card', 'digCooling', 'missedWhileAway'];
  return (
    flags.every((k) => isBool(v[k])) &&
    [0, 1, 2, 3, 4].includes(v.level as number) &&
    [2, 3, 4].includes(v.cap as number) &&
    oneOf(v.activity, ACTIVITIES) &&
    (v.effect === null || oneOf(v.effect, ['laps', 'dig-in']))
  );
}

function validState(v: unknown): v is EngineState {
  if (!isObj(v) || !validRules(v.rules) || !isNum(v.now) || !isNumOrNull(v.pausedAt)) return false;
  const { deadlines: d, rng, stats } = v;
  if (!isObj(d) || !Object.keys(NO_DEADLINES).every((k) => isNumOrNull(d[k]))) return false;
  if (!isObj(rng) || !['a', 'b', 'c', 'd'].every((k) => isNum(rng[k]))) return false;
  return (
    isObj(stats) &&
    isNum(stats.answered) &&
    isNum(stats.treats) &&
    isNumOrNull(stats.cardShownAt) &&
    isNum(stats.longestWaitMs) &&
    Array.isArray(stats.guiltTrips) &&
    stats.guiltTrips.every(isNum)
  );
}

function validEntry(v: unknown): v is LogEntry {
  if (!isObj(v) || !isNum(v.at)) return false;
  switch (v.type) {
    case 'TICK':
      return isNum(v.dtMs) && Number.isInteger(v.count) && (v.count as number) >= 1 && (v.count as number) <= MAX_TICKS;
    case 'STAY_ON':
      return isNum(v.durationMs);
    case 'SESSION_START':
    case 'CAP_CHANGED':
      return oneOf(v.detail, CAPS);
    case 'USER_ACTIVITY':
      return oneOf(v.detail, ACTIVITIES);
    case 'SUPPRESS_CHANGED':
    case 'BUSY':
    case 'WINDOW':
      return oneOf(v.detail, ON_OFF);
    case 'ANSWER_SUBMITTED':
      return oneOf(v.detail, ['correct', 'missed']);
    case 'PRESET':
      return typeof v.detail === 'string' && own(TRAIT_PRESETS, v.detail);
    default:
      return oneOf(v.type, SIMPLE_EVENTS);
  }
}

function validLog(v: unknown): v is EngineLog {
  if (!isObj(v) || v.version !== 1 || !isNum(v.seed) || !isNumOrNull(v.lastGuiltMs) || !isBool(v.truncated)) return false;
  if (typeof v.preset !== 'string' || !own(TRAIT_PRESETS, v.preset)) return false;
  const { tuning, entries } = v;
  if (!isObj(tuning) || !Object.keys(DEFAULT_TUNING).every((k) => isNum(tuning[k]))) return false;
  if (!validState(v.startState)) return false;
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || !entries.every(validEntry)) return false;
  const ticks = entries.reduce((n: number, e: LogEntry) => n + (e.type === 'TICK' ? (e.count ?? 1) : 1), 0);
  return ticks <= MAX_TICKS;
}

const FENCED = new RegExp('```' + ENGINE_LOG_FENCE + '[^\\n]*\\n([\\s\\S]*?)```');

/** The log in a diagnostics bundle's fenced block, or in bare JSON. Null if there is none or it is not a valid log. */
export function extractEngineLog(text: string): EngineLog | null {
  const json = FENCED.exec(text)?.[1] ?? text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return validLog(parsed) ? parsed : null;
}
