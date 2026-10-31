import { TRAIT_PRESETS, type TraitPreset } from '../engine/tuning';
import type { Cap } from '../engine/types';
import { isAccelerator, sameAccelerator } from './accelerator';
import { BUBBLE_HOTKEY } from './bubble';

export const MAX_INTERVAL_MINUTES = 240;
export const MAX_EXCLUDED_APPS = 100;
export const MAX_EXCLUDED_APP_CHARS = 260;

export type ReducedMotionSetting = 'system' | 'on' | 'off';

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
  /** False until onboarding has been finished (or skipped) once. */
  onboarded: boolean;
  /** `system` follows the Windows animation setting. */
  reducedMotion: ReducedMotionSetting;
  /** Read by the updater once it exists (M6). */
  updateChecks: boolean;
  betaChannel: boolean;
  /** The shortcut that focuses the answer bubble, in Electron's accelerator form. */
  bubbleHotkey: string;
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
  onboarded: false,
  reducedMotion: 'system',
  updateChecks: true,
  betaChannel: false,
  bubbleHotkey: BUBBLE_HOTKEY,
};

type Added = 'soundOn' | 'volume' | 'onboarded' | 'reducedMotion' | 'updateChecks' | 'betaChannel' | 'bubbleHotkey';

/** Settings as they may sit on disk: a file saved before these fields existed lacks them. */
export type StoredSettings = Omit<Settings, Added> & Partial<Pick<Settings, Added>>;

/** Fills whatever an older file lacks with the defaults. Never changes a value that is there. */
export function fillSettings(s: StoredSettings): Settings {
  return {
    ...s,
    soundOn: s.soundOn ?? DEFAULT_SETTINGS.soundOn,
    volume: s.volume ?? DEFAULT_SETTINGS.volume,
    onboarded: s.onboarded ?? DEFAULT_SETTINGS.onboarded,
    reducedMotion: s.reducedMotion ?? DEFAULT_SETTINGS.reducedMotion,
    updateChecks: s.updateChecks ?? DEFAULT_SETTINGS.updateChecks,
    betaChannel: s.betaChannel ?? DEFAULT_SETTINGS.betaChannel,
    bubbleHotkey: s.bubbleHotkey ?? DEFAULT_SETTINGS.bubbleHotkey,
  };
}

/** Lower case, trimmed, folder-free, no blanks, no repeats: the form the suppress check compares against. */
export function normalizeExcluded(apps: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of apps) {
    const name = raw.trim().replace(/^.*[\\/]/, '').trim().toLowerCase();
    if (name !== '' && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Why these settings must not be saved, or null if they are fine. Stricter than the stored-file check, which only guards against crashes. */
export function checkSettings(s: Settings): string | null {
  if (!Object.hasOwn(TRAIT_PRESETS, s.preset)) return 'unknown personality preset';
  const { checkinMinMinutes: lo, checkinMaxMinutes: hi } = s;
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo || hi > MAX_INTERVAL_MINUTES) {
    return 'check-in minutes must be whole numbers from 1 to 240, shortest first';
  }
  if (s.excludedApps.length > MAX_EXCLUDED_APPS) return 'too many excluded apps';
  if (s.excludedApps.some((a) => a.trim() === '' || a.length > MAX_EXCLUDED_APP_CHARS)) return 'an excluded app name is empty or too long';
  if (!isAccelerator(s.leaveItHotkey) || !isAccelerator(s.bubbleHotkey)) return 'a shortcut is not usable';
  if (sameAccelerator(s.leaveItHotkey, s.bubbleHotkey)) return 'the two shortcuts must differ';
  return null;
}
