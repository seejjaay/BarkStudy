import type { TraitPreset } from '../../engine/tuning';
import type { Cap } from '../../engine/types';
import { normalizeExcluded, type ReducedMotionSetting } from '../../shared/settings';
import { MAX_GAP, MIN_GAP, wholeMinutes } from './sessionState';

/** The choices the settings page offers, and the small checks behind its boxes. No React in here, so it can be tested alone. */

export type IntervalParse = { ok: true; min: number; max: number } | { ok: false; message: string };

/** Two boxes of text → the check-in gap, or what to tell the user. */
export function parseInterval(min: string, max: string): IntervalParse {
  const lo = wholeMinutes(min);
  const hi = wholeMinutes(max);
  if (lo === null || hi === null) return { ok: false, message: 'Use whole minutes, such as 5 and 15.' };
  if (lo < MIN_GAP) return { ok: false, message: `The shortest gap is ${MIN_GAP} minute.` };
  if (hi > MAX_GAP) return { ok: false, message: `The longest gap is ${MAX_GAP} minutes.` };
  if (hi < lo) return { ok: false, message: 'The longest gap cannot be shorter than the shortest.' };
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
  { value: 2, label: 'Gentle', hint: 'He asks politely and whines when you take your time. Nothing more.' },
  { value: 3, label: 'Playful', hint: 'Adds zoomies: he runs laps around the window you are using.' },
  { value: 4, label: 'Full dog', hint: 'Adds dig-in: he digs at the window and puts the question in front of you until you answer or press Esc.' },
];

export const PRESET_OPTIONS: readonly Option<TraitPreset>[] = [
  { value: 'calm', label: 'Calm', hint: 'Patient and quiet. He gives you plenty of time before he fusses.' },
  { value: 'classic', label: 'Classic', hint: 'A bit of everything. The way Pandesal is meant to be.' },
  { value: 'drama-queen', label: 'Drama queen', hint: 'Needy and theatrical. He escalates fast and sulks loudly.' },
];

export const MOTION_OPTIONS: readonly Option<ReducedMotionSetting>[] = [
  { value: 'system', label: 'Follow Windows', hint: 'Uses the "Show animations" setting in Windows.' },
  { value: 'on', label: 'Always reduce motion', hint: 'He walks slowly, and zoomies do not run laps.' },
  { value: 'off', label: 'Never reduce motion', hint: 'Full speed, whatever Windows says.' },
];
