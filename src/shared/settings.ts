import type { TraitPreset } from '../engine/tuning';
import type { Cap } from '../engine/types';

export interface Settings {
  /** Highest escalation level Pandesal may reach: Gentle 2, Playful 3, Full dog 4. */
  cap: Cap;
  preset: TraitPreset;
  /** Check-ins are spaced between these bounds. */
  checkinMinMinutes: number;
  checkinMaxMinutes: number;
  /** Process names (lower case) that suppress prompts and effects while in front. */
  excludedApps: string[];
  leaveItHotkey: string;
  /** Pandesal's barks, whines and yips. Off means silent. */
  soundOn: boolean;
  /** 0..1. */
  volume: number;
}

/** Video calls and recorders: Pandesal stays quiet while these are in front. Games are caught by the fullscreen check. */
export const DEFAULT_EXCLUDED_APPS: readonly string[] = ['zoom.exe', 'teams.exe', 'ms-teams.exe', 'webex.exe', 'skype.exe', 'obs64.exe', 'obs32.exe'];

export const DEFAULT_SETTINGS: Settings = {
  cap: 4,
  preset: 'classic',
  checkinMinMinutes: 5,
  checkinMaxMinutes: 15,
  excludedApps: [...DEFAULT_EXCLUDED_APPS],
  leaveItHotkey: 'Ctrl+Alt+L',
  soundOn: true,
  volume: 0.4,
};

/** Settings as they may sit on disk: a file saved before the sound fields existed has neither. */
export type StoredSettings = Omit<Settings, 'soundOn' | 'volume'> & Partial<Pick<Settings, 'soundOn' | 'volume'>>;

/** Fills whatever an older file lacks with the defaults. Never changes a value that is there. */
export function fillSettings(s: StoredSettings): Settings {
  return { ...s, soundOn: s.soundOn ?? DEFAULT_SETTINGS.soundOn, volume: s.volume ?? DEFAULT_SETTINGS.volume };
}
