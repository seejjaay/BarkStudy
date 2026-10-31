import type { Mood } from './mood';

/**
 * Pandesal's sounds as data. They are placeholders: the overlay synthesizes each recipe with Web Audio, and real audio
 * files can replace them behind the same names without anything else changing.
 */

export type SoundName = 'bark' | 'whine' | 'yip' | 'scratch';

/** One piece of a sound: a pitched tone, or a burst of noise (optionally filtered around `freqHz`). Times are from the start of the sound. */
export interface SoundPart {
  kind: 'tone' | 'noise';
  startMs: number;
  durationMs: number;
  /** A tone's pitch, or the centre of a noise burst's filter. A noise part without it is unfiltered. */
  freqHz?: number;
  /** Where the pitch (or filter) glides to by the end of the part. */
  freqEndHz?: number;
  /** Peak level, 0..1, before the volume setting. */
  gain: number;
}

export interface SoundRecipe {
  parts: SoundPart[];
}

/** No sound runs this long or longer, and none loops. */
export const MAX_SOUND_MS = 1500;

export const RECIPES: Record<SoundName, SoundRecipe> = {
  // Two low woofs, each a dropping tone with a puff of noise at the front.
  bark: {
    parts: [
      { kind: 'tone', startMs: 0, durationMs: 140, freqHz: 430, freqEndHz: 250, gain: 0.8 },
      { kind: 'noise', startMs: 0, durationMs: 60, freqHz: 900, gain: 0.35 },
      { kind: 'tone', startMs: 220, durationMs: 160, freqHz: 390, freqEndHz: 220, gain: 0.8 },
      { kind: 'noise', startMs: 220, durationMs: 60, freqHz: 900, gain: 0.35 },
    ],
  },
  // A long thin note that climbs and then sags.
  whine: {
    parts: [
      { kind: 'tone', startMs: 0, durationMs: 420, freqHz: 520, freqEndHz: 820, gain: 0.5 },
      { kind: 'tone', startMs: 420, durationMs: 380, freqHz: 820, freqEndHz: 560, gain: 0.45 },
    ],
  },
  // Two quick high chirps.
  yip: {
    parts: [
      { kind: 'tone', startMs: 0, durationMs: 90, freqHz: 900, freqEndHz: 1350, gain: 0.6 },
      { kind: 'tone', startMs: 140, durationMs: 90, freqHz: 1000, freqEndHz: 1500, gain: 0.6 },
    ],
  },
  // Five scrabbling bursts of filtered noise.
  scratch: {
    parts: [0, 130, 260, 390, 520].map((startMs, i): SoundPart => ({ kind: 'noise', startMs, durationMs: 90, freqHz: 2400, freqEndHz: 1400 + i * 100, gain: 0.5 })),
  },
};

/** When the last part of the recipe ends. */
export function recipeLengthMs(r: SoundRecipe): number {
  return r.parts.reduce((end, p) => Math.max(end, p.startMs + p.durationMs), 0);
}

/** Which sound goes with something that just happened, or null for no sound. */
export function soundFor(event: { kind: 'effect'; effect: 'laps' | 'dig' } | { kind: 'mood'; mood: Mood }): SoundName | null {
  if (event.kind === 'effect') return event.effect === 'laps' ? 'bark' : 'scratch';
  switch (event.mood) {
    case 'whine':
      return 'whine';
    case 'happy':
    case 'ecstatic':
      return 'yip';
    default:
      return null;
  }
}
