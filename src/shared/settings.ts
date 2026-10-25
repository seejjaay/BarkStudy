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
};
