import { describe, expect, it } from 'vitest';
import type { DogFrame } from '../../src/shared/ipc';
import { drawDog } from '../../src/renderer/overlay/draw';

type Call = [string, ...unknown[]];

/** A canvas context that records method calls and swallows property writes. */
function fakeCtx() {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop) => (...args: unknown[]) => {
        calls.push([String(prop), ...args]);
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const frame = (over: Partial<DogFrame> = {}): DogFrame => ({
  x: 500,
  y: 400,
  facing: 1,
  pose: 'walk',
  mood: 'idle',
  clip: [{ x: 468, y: 352, width: 64, height: 48 }],
  reducedMotion: false,
  ...over,
});
const names = (calls: Call[]) => calls.map((c) => c[0]);

describe('drawDog', () => {
  it('draws nothing when the dog is fully hidden', () => {
    const { ctx, calls } = fakeCtx();
    drawDog(ctx, frame({ clip: [] }), 0);
    expect(names(calls).filter((n) => ['fill', 'stroke', 'fillRect', 'ellipse', 'arc'].includes(n))).toEqual([]);
  });

  it('clips to the visible rectangles and keeps save/restore balanced', () => {
    const { ctx, calls } = fakeCtx();
    drawDog(ctx, frame({ clip: [{ x: 468, y: 352, width: 20, height: 48 }, { x: 500, y: 352, width: 32, height: 48 }] }), 0);
    const n = names(calls);
    expect(n).toContain('clip');
    expect(n).toContain('fill');
    expect(n.filter((x) => x === 'save').length).toBe(n.filter((x) => x === 'restore').length);
    expect(calls.filter((c) => c[0] === 'rect')).toHaveLength(2);
  });

  it.each(['walk', 'sit', 'fall'] as const)('draws the %s pose', (pose) => {
    const { ctx, calls } = fakeCtx();
    drawDog(ctx, frame({ pose }), 100);
    expect(names(calls)).toContain('fill');
  });

  it('a walking dog bobs, and does not when motion is reduced', () => {
    const at = (t: number, reducedMotion: boolean) => {
      const { ctx, calls } = fakeCtx();
      drawDog(ctx, frame({ reducedMotion }), t);
      return JSON.stringify(calls);
    };
    expect(at(0, false)).not.toBe(at(62, false)); // a quarter of the 4 Hz bob
    expect(at(0, true)).toBe(at(62, true));
  });
});
