import { describe, expect, it } from 'vitest';
import type { DogFrame } from '../../src/shared/ipc';
import { dogHit, dogHitRect, inside } from '../../src/renderer/overlay/hit';

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

describe('hit-testing', () => {
  it('dogHitRect is centred on the feet', () => {
    expect(dogHitRect(frame())).toEqual({ x: 468, y: 352, width: 64, height: 48 });
  });

  it('inside includes the edges and excludes outside points', () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(inside(r, 10, 20)).toBe(true);
    expect(inside(r, 40, 60)).toBe(true);
    expect(inside(r, 9, 30)).toBe(false);
    expect(inside(r, 41, 30)).toBe(false);
    expect(inside(r, 20, 61)).toBe(false);
  });

  it('dogHit is true over the visible part of the dog', () => {
    expect(dogHit(frame(), 500, 380)).toBe(true);
  });

  it('dogHit is false over a part hidden behind a window', () => {
    const f = frame({ clip: [{ x: 468, y: 352, width: 32, height: 48 }] }); // right half hidden
    expect(dogHit(f, 485, 380)).toBe(true);
    expect(dogHit(f, 520, 380)).toBe(false);
  });

  it('dogHit is false when the dog is hidden entirely', () => {
    expect(dogHit(frame({ clip: [] }), 500, 380)).toBe(false);
    expect(dogHit(null, 500, 380)).toBe(false);
  });
});
