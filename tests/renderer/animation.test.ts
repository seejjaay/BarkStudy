import { describe, expect, it } from 'vitest';
import type { DogFrame } from '../../src/shared/ipc';
import { needsAnimation } from '../../src/renderer/overlay/effects';

const frame = (over: Partial<DogFrame> = {}): DogFrame => ({
  x: 500,
  y: 400,
  facing: 1,
  pose: 'sit',
  mood: 'idle',
  clip: [{ x: 468, y: 352, width: 64, height: 48 }],
  reducedMotion: false,
  ...over,
});

describe('needsAnimation', () => {
  it('is true for an effect', () => {
    const effect = { kind: 'dig', seed: 1, elapsedMs: 0, rect: { x: 0, y: 0, width: 10, height: 10 } } as const;
    expect(needsAnimation(frame({ effect }), false, false)).toBe(true);
    expect(needsAnimation(frame({ effect: { ...effect, kind: 'laps' } }), false, false)).toBe(true);
  });

  it.each(['run', 'hop'] as const)('is true for the %s pose', (pose) => {
    expect(needsAnimation(frame({ pose }), false, false)).toBe(true);
  });

  it.each(['happy', 'ecstatic'] as const)('is true for the %s mood (spin and wag)', (mood) => {
    expect(needsAnimation(frame({ mood }), false, false)).toBe(true);
  });

  it('is true while prints are fading', () => {
    expect(needsAnimation(frame(), true, false)).toBe(true);
    expect(needsAnimation(null, true, false)).toBe(true);
  });

  it('is false for an idle sitting dog, whatever else is going on in the other moods', () => {
    expect(needsAnimation(frame(), false, false)).toBe(false);
    for (const mood of ['idle', 'wander', 'nap', 'curious', 'pleading', 'follow-cursor', 'whine', 'calm', 'sulk', 'greet', 'sit'] as const) {
      expect(needsAnimation(frame({ mood }), false, false)).toBe(false);
    }
    expect(needsAnimation(frame({ pose: 'walk' }), false, false)).toBe(false); // frames keep arriving while he walks
  });

  it('is false when there is no frame', () => {
    expect(needsAnimation(null, false, false)).toBe(false);
  });

  it('under reduced motion, is false for everything except a fade in progress', () => {
    const effect = { kind: 'laps', seed: 1, elapsedMs: 0, rect: { x: 0, y: 0, width: 10, height: 10 } } as const;
    expect(needsAnimation(frame({ effect }), false, true)).toBe(false);
    expect(needsAnimation(frame({ pose: 'run' }), false, true)).toBe(false);
    expect(needsAnimation(frame({ pose: 'hop' }), false, true)).toBe(false);
    expect(needsAnimation(frame({ mood: 'happy' }), false, true)).toBe(false);
    expect(needsAnimation(frame({ mood: 'ecstatic' }), false, true)).toBe(false);
    expect(needsAnimation(frame({ mood: 'happy' }), true, true)).toBe(true);
    expect(needsAnimation(null, true, true)).toBe(true);
  });
});
