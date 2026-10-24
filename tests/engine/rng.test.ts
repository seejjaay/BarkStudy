import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng, nextFloat, nextInt, weightedPick, type RngState } from '../../src/engine/rng';

function floats(seed: number, n: number): number[] {
  let r = createRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [v, next] = nextFloat(r);
    out.push(v);
    r = next;
  }
  return out;
}

describe('rng', () => {
  it('same seed gives same 1000-value sequence', () => {
    expect(floats(42, 1000)).toEqual(floats(42, 1000));
  });

  it('different seeds diverge within 3 values', () => {
    const a = floats(1, 3);
    const b = floats(2, 3);
    expect(a.some((v, i) => v !== b[i])).toBe(true);
  });

  it('nextFloat always in [0,1)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 50 }), (seed, n) => {
        for (const v of floats(seed, n)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
    );
  });

  it('nextInt stays within [min, maxExcl)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 1, max: 100 }), (seed, min, span) => {
        const [v] = nextInt(createRng(seed), min, min + span);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(min);
        expect(v).toBeLessThan(min + span);
      }),
    );
  });

  it('weightedPick never picks weight-0 items', () => {
    const items = [
      { item: 'never', weight: 0 },
      { item: 'a', weight: 1 },
      { item: 'b', weight: 3 },
      { item: 'never2', weight: 0 },
    ];
    let r = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const [pick, next] = weightedPick(r, items);
      expect(pick === 'a' || pick === 'b').toBe(true);
      r = next;
    }
  });

  it('weightedPick frequencies within ±2% over 100k draws', () => {
    const items = [
      { item: 'a', weight: 1 },
      { item: 'b', weight: 2 },
      { item: 'c', weight: 7 },
    ];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    let r = createRng(2024);
    const draws = 100_000;
    for (let i = 0; i < draws; i++) {
      const [pick, next] = weightedPick(r, items);
      counts[pick] = (counts[pick] ?? 0) + 1;
      r = next;
    }
    expect(Math.abs((counts.a ?? 0) / draws - 0.1)).toBeLessThan(0.02);
    expect(Math.abs((counts.b ?? 0) / draws - 0.2)).toBeLessThan(0.02);
    expect(Math.abs((counts.c ?? 0) / draws - 0.7)).toBeLessThan(0.02);
  });

  it('input state is not mutated', () => {
    const r: RngState = createRng(99);
    const before = { ...r };
    nextFloat(r);
    nextInt(r, 0, 10);
    weightedPick(r, [{ item: 1, weight: 1 }]);
    expect(r).toEqual(before);
  });
});
