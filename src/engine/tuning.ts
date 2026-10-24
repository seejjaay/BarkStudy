import type { Traits, Tuning } from './types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const DEFAULT_TUNING: Tuning = {
  checkinMinMs: 5 * MINUTE,
  checkinMaxMs: 15 * MINUTE,
  firstEscalationMs: 90 * SECOND,
  escalationStepMs: 60 * SECOND,
  activeSlowdown: 2,
  digInCooldownMs: 10 * MINUTE,
  lapsMaxMs: 6 * SECOND,
  digInMaxMs: 8 * SECOND,
  guiltThresholdMs: 2 * MINUTE,
  awayIdleMs: 5 * MINUTE,
  busyIdleMs: 10 * SECOND,
};

export const DEFAULT_TRAITS: Traits = { neediness: 0.5, drama: 0.5, patience: 0.5, zoominess: 0.5 };

export const TRAIT_PRESETS = {
  calm: { neediness: 0.2, drama: 0.1, patience: 0.8, zoominess: 0.3 },
  classic: DEFAULT_TRAITS,
  'drama-queen': { neediness: 0.9, drama: 0.95, patience: 0.2, zoominess: 0.8 },
} as const satisfies Record<string, Traits>;

export type TraitPreset = keyof typeof TRAIT_PRESETS;
