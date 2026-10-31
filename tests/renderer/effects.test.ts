import { describe, expect, it } from 'vitest';
import { LAP_SPEED, lapPerimeter, lapPoint } from '../../src/shared/behaviour';
import type { Rect } from '../../src/shared/geometry';
import { PRINT_FADE_MS, dirtParticles, lapOrigin, pawPrints } from '../../src/renderer/overlay/effects';

const origin = { x: 300, y: 200 };
const rect: Rect = { x: 100, y: 80, width: 400, height: 240 };

/** How far (x, y) is from the outline of `r`, inside or out. */
function distanceToOutline(r: Rect, x: number, y: number): number {
  const outside = Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.width)), Math.max(r.y - y, 0, y - (r.y + r.height)));
  if (outside > 0) return outside;
  return Math.min(x - r.x, r.x + r.width - x, y - r.y, r.y + r.height - y);
}

describe('dirtParticles', () => {
  it('is deterministic: the same seed and time give the same dirt, another seed gives other dirt', () => {
    const a = dirtParticles(7, 900, origin, false);
    expect(a.length).toBeGreaterThan(0);
    expect(dirtParticles(7, 900, origin, false)).toEqual(a);
    expect(dirtParticles(8, 900, origin, false)).not.toEqual(a);
  });

  it('falls: after the throw, a particle sinks as time passes', () => {
    // 900 ms and 1100 ms are the same throw of the first particle (one throw lasts 600 ms), 300 and 500 ms in.
    const early = dirtParticles(7, 900, origin, false)[0]!;
    const late = dirtParticles(7, 1100, origin, false)[0]!;
    expect(late.y).toBeGreaterThan(early.y);
  });

  it('starts at the origin and fades out over the throw', () => {
    const fresh = dirtParticles(7, 0, origin, false)[0]!;
    expect(fresh.x).toBeCloseTo(origin.x);
    expect(fresh.y).toBeCloseTo(origin.y);
    expect(fresh.alpha).toBeCloseTo(1);
    for (const p of dirtParticles(7, 1234, origin, false)) {
      expect(p.alpha).toBeGreaterThan(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
      expect(p.size).toBeGreaterThan(0);
    }
  });

  it('builds up a stream: later particles are thrown after the first ones', () => {
    expect(dirtParticles(7, 0, origin, false).length).toBeLessThan(dirtParticles(7, 2000, origin, false).length);
  });

  it('reduced motion: dirt does not move', () => {
    const at = (t: number) => dirtParticles(7, t, origin, true);
    expect(at(0).length).toBeGreaterThan(0);
    expect(at(500)).toEqual(at(0));
    expect(at(4321)).toEqual(at(0));
  });
});

describe('pawPrints', () => {
  it('prints lie on the frame: each is within 4 px of the outline', () => {
    for (const elapsed of [300, 1500, 4000, 6000]) {
      const prints = pawPrints(7, rect, elapsed, 0);
      expect(prints.length).toBeGreaterThan(0);
      for (const p of prints) expect(distanceToOutline(rect, p.x, p.y)).toBeLessThanOrEqual(4);
    }
  });

  it('prints fade: full while the effect runs, gone PRINT_FADE_MS after it', () => {
    expect(pawPrints(7, rect, 3000, 0).every((p) => p.alpha === 1)).toBe(true);
    expect(pawPrints(7, rect, 3000, PRINT_FADE_MS / 2).every((p) => p.alpha === 0.5)).toBe(true);
    expect(pawPrints(7, rect, 3000, PRINT_FADE_MS).every((p) => p.alpha === 0)).toBe(true);
    expect(pawPrints(7, rect, 3000, PRINT_FADE_MS * 3).every((p) => p.alpha === 0)).toBe(true);
  });

  it('is deterministic by seed', () => {
    const a = pawPrints(7, rect, 2000, 0);
    expect(pawPrints(7, rect, 2000, 0)).toEqual(a);
    expect(pawPrints(8, rect, 2000, 0)).not.toEqual(a);
  });

  it('lays prints as he runs: none before he has moved, then a growing trail that is capped', () => {
    expect(pawPrints(7, rect, 0, 0)).toEqual([]);
    const some = pawPrints(7, rect, 1000, 0).length;
    const more = pawPrints(7, rect, 2000, 0).length;
    expect(some).toBeGreaterThan(0);
    expect(more).toBeGreaterThan(some);
    expect(pawPrints(7, rect, 6000, 0).length).toBe(pawPrints(7, rect, 12000, 0).length);
  });

  it('points each print along his heading: right along the top edge, down the right edge', () => {
    const top = pawPrints(7, rect, 400, 0, 0); // 180 px along the top edge from its left corner
    expect(top.length).toBeGreaterThan(0);
    for (const p of top) expect(p.angle).toBe(0);
    const right = pawPrints(7, rect, 400, 0, rect.width + 10);
    for (const p of right) expect(p.angle).toBeCloseTo(Math.PI / 2);
  });

  it('starts laying from where the lap began', () => {
    const from = 250;
    const prints = pawPrints(7, rect, 400, 0, from);
    const first = lapPoint(rect, from + LAP_SPEED * 400); // where he is now
    const last = prints[prints.length - 1]!;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThan(60);
  });
});

describe('lapOrigin', () => {
  it('works the start of a lap back from where he is now, on every side', () => {
    const perimeter = lapPerimeter(rect);
    for (const d of [30, 600, 750, 1100, 1270]) {
      const now = lapPoint(rect, d);
      const origin = lapOrigin(rect, now, now.side, 0);
      expect(((origin % perimeter) + perimeter) % perimeter).toBeCloseTo(d);
    }
  });

  it('takes off the distance run since', () => {
    const now = lapPoint(rect, 700);
    expect(lapOrigin(rect, now, now.side, 1000)).toBeCloseTo(700 - LAP_SPEED * 1000);
  });
});
