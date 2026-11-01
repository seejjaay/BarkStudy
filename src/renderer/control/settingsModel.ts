import type { TraitPreset } from '../../engine/tuning';
import type { Cap } from '../../engine/types';
import { SETTINGS as T } from '../../shared/i18n/en';
import { normalizeExcluded, type ReducedMotionSetting } from '../../shared/settings';
import { MAX_GAP, MIN_GAP, wholeMinutes } from './sessionState';

/** The choices the settings page offers, and the small checks behind its boxes. No React in here, so it can be tested alone. */

export type IntervalParse = { ok: true; min: number; max: number } | { ok: false; message: string };

/** Two boxes of text → the check-in gap, or what to tell the user. */
export function parseInterval(min: string, max: string): IntervalParse {
  const lo = wholeMinutes(min);
  const hi = wholeMinutes(max);
  if (lo === null || hi === null) return { ok: false, message: T.intervalWhole };
  if (lo < MIN_GAP) return { ok: false, message: T.intervalShortest(MIN_GAP) };
  if (hi > MAX_GAP) return { ok: false, message: T.intervalLongest(MAX_GAP) };
  if (hi < lo) return { ok: false, message: T.intervalOrder };
  return { ok: true, min: lo, max: hi };
}

/** The excluded-apps list with one more app in it, in the form the suppress check compares against. Blank or repeated entries change nothing. */
export function addExcluded(list: readonly string[], entry: string): string[] {
  return normalizeExcluded([...list, entry]);
}

export const volumePercent = (v: number): string => `${Math.round(v * 100)}%`;

interface Option<T> {
  value: T;
  label: string;
  hint: string;
}

export const CAP_OPTIONS: readonly Option<Cap>[] = [
  { value: 2, ...T.caps.gentle },
  { value: 3, ...T.caps.playful },
  { value: 4, ...T.caps.full },
];

export const PRESET_OPTIONS: readonly Option<TraitPreset>[] = [
  { value: 'calm', ...T.presets.calm },
  { value: 'classic', ...T.presets.classic },
  { value: 'drama-queen', ...T.presets.dramaQueen },
];

export const MOTION_OPTIONS: readonly Option<ReducedMotionSetting>[] = [
  { value: 'system', ...T.motions.system },
  { value: 'on', ...T.motions.on },
  { value: 'off', ...T.motions.off },
];

/**
 * Remembers the last value that was saved, so blur, Enter and key-up can all ask "is this worth saving?" without
 * saving the same value twice. Call `committed` once a save goes through, and again when the saved value changes underneath.
 */
export function createCommitGuard<T>(initial: T): { shouldCommit(next: T): boolean; committed(value: T): void } {
  let last = initial;
  return {
    shouldCommit: (next) => next !== last,
    committed: (value) => {
      last = value;
    },
  };
}

/**
 * Runs `save` for `next` unless it is already the committed value or is being saved right now, so Enter followed by
 * blur (or pointer-up followed by key-up) sends one save. `next` counts as committed from the moment the save starts;
 * if it fails, `rollbackTo` (the value that is really saved) is put back so the same value can be tried again.
 * Resolves to the save's result, or null when nothing was sent.
 */
export async function commitOnce<T>(guard: { shouldCommit(next: T): boolean; committed(value: T): void }, next: T, rollbackTo: T, save: () => Promise<boolean>): Promise<boolean | null> {
  if (!guard.shouldCommit(next)) return null;
  guard.committed(next);
  const ok = await save();
  if (!ok) guard.committed(rollbackTo);
  return ok;
}
