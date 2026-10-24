import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine/rng';
import { roamStep, type RoamState } from '../../src/shared/roam';

const fresh: RoamState = { walk: 0, untilMs: 0 };

describe('roamStep', () => {
  it('after untilMs it picks sit about 40% and walk about 60% over 10k draws', () => {
    let rng = createRng(7);
    let sits = 0;
    for (let i = 0; i < 10_000; i++) {
      const [s, next] = roamStep(fresh, 1000, 0, rng);
      rng = next;
      if (s.walk === 0) sits++;
    }
    expect(sits / 10_000).toBeGreaterThan(0.37);
    expect(sits / 10_000).toBeLessThan(0.43);
  });

  it('sit lasts 3000-10000 ms and walk 2000-6000 ms', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const [s] = roamStep(fresh, 1000, 0, createRng(seed));
        const dur = s.untilMs - 1000;
        if (s.walk === 0) {
          expect(dur).toBeGreaterThanOrEqual(3000);
          expect(dur).toBeLessThan(10_000);
        } else {
          expect(dur).toBeGreaterThanOrEqual(2000);
          expect(dur).toBeLessThan(6000);
        }
      }),
    );
  });

  it('keeps the current action until untilMs', () => {
    const s: RoamState = { walk: 1, untilMs: 5000 };
    const [next] = roamStep(s, 4999, 0, createRng(1));
    expect(next).toEqual(s);
  });

  it('walking into an edge reverses direction and keeps untilMs', () => {
    const [next] = roamStep({ walk: 1, untilMs: 5000 }, 2000, 1, createRng(1));
    expect(next).toEqual({ walk: -1, untilMs: 5000 });
    const [left] = roamStep({ walk: -1, untilMs: 5000 }, 2000, -1, createRng(1));
    expect(left).toEqual({ walk: 1, untilMs: 5000 });
  });

  it('a new walk never heads straight into the edge the dog is on', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const [s] = roamStep(fresh, 1000, 1, createRng(seed));
        expect(s.walk).not.toBe(1);
      }),
    );
  });

  it('is deterministic for the same rng', () => {
    expect(roamStep(fresh, 1000, 0, createRng(3))).toEqual(roamStep(fresh, 1000, 0, createRng(3)));
  });
});
