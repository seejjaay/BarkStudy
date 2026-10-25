import { describe, expect, it } from 'vitest';
import type { DogFrame } from '../../src/shared/ipc';
import type { Mood } from '../../src/shared/mood';
import { drawDog, paintDirt, paintPrints, proceduralRenderer } from '../../src/renderer/overlay/procedural';

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

  it.each(['walk', 'sit', 'fall', 'run', 'hop', 'dig', 'curl'] as const)('draws the %s pose', (pose) => {
    const { ctx, calls } = fakeCtx();
    drawDog(ctx, frame({ pose }), 100);
    expect(names(calls)).toContain('fill');
  });

  it('draws an unknown pose as a walk', () => {
    const shape = (pose: string) => {
      const { ctx, calls } = fakeCtx();
      drawDog(ctx, frame({ pose: pose as DogFrame['pose'] }), 100);
      return JSON.stringify(calls);
    };
    expect(shape('moonwalk')).toBe(shape('walk'));
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

const shape = (over: Partial<DogFrame>, t = 100): string => {
  const { ctx, calls } = fakeCtx();
  drawDog(ctx, frame(over), t);
  return JSON.stringify(calls);
};

describe('moods are told apart by shape, not by colour alone', () => {
  // The fake context records geometry and strokes but not fill colours, so equal recordings would mean equal shapes.
  const moods: Mood[] = ['idle', 'curious', 'pleading', 'whine', 'zoomies', 'happy', 'ecstatic', 'sulk', 'nap', 'greet', 'sit'];

  it('every listed mood looks different from every other, in the same pose', () => {
    const shapes = moods.map((mood) => shape({ pose: 'sit', mood }));
    expect(new Set(shapes).size).toBe(moods.length);
  });

  it('digging puts his head down, and curling up is not standing', () => {
    expect(shape({ pose: 'dig', mood: 'dig' })).not.toBe(shape({ pose: 'walk', mood: 'idle' }));
    expect(shape({ pose: 'curl', mood: 'idle' })).not.toBe(shape({ pose: 'sit', mood: 'idle' }));
  });

  it('curling up closes his eyes, as napping does', () => {
    expect(shape({ pose: 'curl', mood: 'idle' })).toBe(shape({ pose: 'curl', mood: 'nap' }));
    expect(shape({ pose: 'sit', mood: 'nap' })).not.toBe(shape({ pose: 'sit', mood: 'idle' }));
  });

  it('every mood draws in every pose, with save and restore balanced', () => {
    for (const mood of moods) {
      for (const pose of ['walk', 'sit', 'fall', 'run', 'hop', 'dig', 'curl'] as const) {
        const { ctx, calls } = fakeCtx();
        drawDog(ctx, frame({ pose, mood }), 123);
        const n = names(calls);
        expect(n).toContain('fill');
        expect(n.filter((x) => x === 'save').length).toBe(n.filter((x) => x === 'restore').length);
      }
    }
  });

  it('happy and ecstatic spin and wag, faster for ecstatic, and hold still when motion is reduced', () => {
    for (const mood of ['happy', 'ecstatic'] as const) {
      expect(shape({ mood }, 0)).not.toBe(shape({ mood }, 37));
      expect(shape({ mood, reducedMotion: true }, 0)).toBe(shape({ mood, reducedMotion: true }, 37));
    }
  });

  it('a calm sitting dog does not move at all between frames', () => {
    expect(shape({ pose: 'sit', mood: 'idle' }, 0)).toBe(shape({ pose: 'sit', mood: 'idle' }, 37));
  });

  it('running and digging animate, and stop when motion is reduced', () => {
    for (const pose of ['run', 'dig'] as const) {
      expect(shape({ pose }, 0)).not.toBe(shape({ pose }, 31));
      expect(shape({ pose, reducedMotion: true }, 0)).toBe(shape({ pose, reducedMotion: true }, 31));
    }
  });
});

describe('orientation', () => {
  const rotations = (over: Partial<DogFrame>) => {
    const { ctx, calls } = fakeCtx();
    drawDog(ctx, frame(over), 0);
    return calls.filter((c) => c[0] === 'rotate' && c.length === 2).map((c) => c[1]);
  };
  const scales = (over: Partial<DogFrame>) => {
    const { ctx, calls } = fakeCtx();
    drawDog(ctx, frame(over), 0);
    return calls.filter((c) => c[0] === 'scale').map((c) => c.slice(1));
  };

  it('mirrors him to face left', () => {
    expect(scales({ facing: -1 })).toContainEqual([-1, 1]);
    expect(scales({ facing: 1 })).not.toContainEqual([-1, 1]);
  });

  it('on laps, turns him so his back faces away from the window', () => {
    const body = (side: DogFrame['side']) => rotations({ pose: 'run', side })[0];
    expect(body('top')).toBe(0);
    expect(body('right')).toBeCloseTo(Math.PI / 2);
    expect(body('bottom')).toBeCloseTo(Math.PI);
    expect(body('left')).toBeCloseTo(-Math.PI / 2);
  });

  it('on laps, runs round clockwise whichever way facing says, so facing is not mirrored on top of the turn', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(scales({ pose: 'run', side, facing: -1 })).not.toContainEqual([-1, 1]);
    }
  });

  it('sulking turns his back: he faces away from where he was heading', () => {
    expect(scales({ mood: 'sulk', facing: 1 })).toContainEqual([-1, 1]);
  });
});

describe('proceduralRenderer', () => {
  it('draws through drawDog', () => {
    const { ctx, calls } = fakeCtx();
    proceduralRenderer.draw(ctx, frame({ pose: 'sit' }), 0);
    expect(names(calls)).toContain('fill');
  });
});

describe('paintDirt and paintPrints', () => {
  it('paintDirt fills one speck per particle, and balances save and restore', () => {
    const { ctx, calls } = fakeCtx();
    paintDirt(ctx, [
      { x: 1, y: 2, size: 3, alpha: 1 },
      { x: 4, y: 5, size: 2, alpha: 0.4 },
    ]);
    const n = names(calls);
    expect(n.filter((x) => x === 'fillRect')).toHaveLength(2);
    expect(n.filter((x) => x === 'save').length).toBe(n.filter((x) => x === 'restore').length);
  });

  it('paintPrints skips prints that have faded out, and does not clip', () => {
    const { ctx, calls } = fakeCtx();
    paintPrints(ctx, [
      { x: 10, y: 10, angle: 0, alpha: 1 },
      { x: 20, y: 20, angle: 1, alpha: 0 },
    ]);
    const n = names(calls);
    expect(n.filter((x) => x === 'translate')).toHaveLength(1);
    expect(n).not.toContain('clip');
    expect(n.filter((x) => x === 'save').length).toBe(n.filter((x) => x === 'restore').length);
  });
});
