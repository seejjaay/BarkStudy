import type { RuleEvent } from './types';

/** Absolute times on the engine's own clock (`EngineState.now`), or null when not armed. */
export interface Deadlines {
  checkin: number | null;
  timeout: number | null;
  effectEnd: number | null;
  digCooldownEnd: number | null;
  stayEnd: number | null;
}

export type DeadlineKey = keyof Deadlines;

export const NO_DEADLINES: Deadlines = {
  checkin: null,
  timeout: null,
  effectEnd: null,
  digCooldownEnd: null,
  stayEnd: null,
};

/** Tie-break when two deadlines land on the same instant: wind effects down before starting new prompts. */
const FIRE_ORDER: readonly DeadlineKey[] = ['effectEnd', 'digCooldownEnd', 'stayEnd', 'checkin', 'timeout'];

export const DEADLINE_EVENT: Record<DeadlineKey, RuleEvent> = {
  checkin: { type: 'CHECKIN_DUE' },
  timeout: { type: 'CHECKIN_TIMEOUT' },
  effectEnd: { type: 'EFFECT_EXPIRED' },
  digCooldownEnd: { type: 'DIG_COOLDOWN_EXPIRED' },
  stayEnd: { type: 'STAY_EXPIRED' },
};

/** The earliest armed deadline at or before `until`, or null. */
export function nextDue(d: Deadlines, until: number): { key: DeadlineKey; at: number } | null {
  let best: { key: DeadlineKey; at: number } | null = null;
  for (const key of FIRE_ORDER) {
    const at = d[key];
    if (at !== null && at <= until && (best === null || at < best.at)) best = { key, at };
  }
  return best;
}

export function shiftDeadlines(d: Deadlines, by: number): Deadlines {
  const out = { ...d };
  for (const key of FIRE_ORDER) {
    const at = d[key];
    if (at !== null) out[key] = at + by;
  }
  return out;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
