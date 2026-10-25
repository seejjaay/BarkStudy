import type { SoundName } from '../shared/sounds';

/** A sound waits at least this long after the last one that was let through. */
export const SOUND_MIN_GAP_MS = 3000;

export interface SoundContext {
  soundOn: boolean;
  /** 0..1. */
  volume: number;
  /** Suppressed, paused, on a Stay, or away: no sound at all. */
  quiet: boolean;
}

export interface SoundGate {
  /** True if this sound may play now. Only a sound that passes starts the gap; one that is dropped does not push it out. */
  pass: (name: SoundName, ctx: SoundContext) => boolean;
}

export function createSoundGate(clock: { now(): number } = { now: () => Date.now() }): SoundGate {
  let lastAt = -Infinity;
  return {
    pass(_name, ctx) {
      if (!ctx.soundOn || ctx.quiet || !(ctx.volume > 0)) return false;
      const now = clock.now();
      if (now - lastAt < SOUND_MIN_GAP_MS) return false;
      lastAt = now;
      return true;
    },
  };
}
