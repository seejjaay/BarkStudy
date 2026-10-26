import { describe, expect, it } from 'vitest';
import {
  digSpot,
  FOLLOW_DEADZONE,
  followDirection,
  HOP_HEIGHT,
  HOP_MS,
  hopPoint,
  LAP_SPEED,
  lapPerimeter,
  lapPoint,
  lapRect,
  type Point,
} from '../../src/shared/behaviour';
import type { Rect } from '../../src/shared/geometry';

const R: Rect = { x: 100, y: 50, width: 400, height: 300 };
const RIGHT = R.x + R.width; // 500
const BOTTOM = R.y + R.height; // 350

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** True when `p` is within `tol` px of some edge of `r` (and not out past its ends). */
function nearEdge(p: Point, r: Rect, tol: number): boolean {
  const right = r.x + r.width;
  const bottom = r.y + r.height;
  const withinX = p.x >= r.x - tol && p.x <= right + tol;
  const withinY = p.y >= r.y - tol && p.y <= bottom + tol;
  const onHorizontal = withinX && (Math.abs(p.y - r.y) <= tol || Math.abs(p.y - bottom) <= tol);
  const onVertical = withinY && (Math.abs(p.x - r.x) <= tol || Math.abs(p.x - right) <= tol);
  return onHorizontal || onVertical;
}

describe('behaviour constants', () => {
  it('uses the agreed values', () => {
    expect(LAP_SPEED).toBe(0.45);
    expect(HOP_MS).toBe(600);
    expect(HOP_HEIGHT).toBe(60);
    expect(FOLLOW_DEADZONE).toBe(24);
  });
});

describe('lapPerimeter', () => {
  it('is twice width plus height', () => {
    expect(lapPerimeter(R)).toBe(1400);
  });
});

describe('lapPoint', () => {
  it('lap points stay on the perimeter', () => {
    const per = lapPerimeter(R);
    for (let i = 0; i < 200; i++) {
      const d = (i / 200) * 2 * per;
      const p = lapPoint(R, d);
      expect(nearEdge(p, R, 1), `distance ${d} gave ${p.x},${p.y}`).toBe(true);
    }
  });

  it('a lap is continuous, corners included', () => {
    const per = lapPerimeter(R);
    let prev = lapPoint(R, 0);
    for (let d = 1; d <= 2 * per; d++) {
      const next = lapPoint(R, d);
      expect(dist(prev, next), `step into distance ${d}`).toBeLessThanOrEqual(1.01);
      prev = next;
    }
  });

  it('one perimeter is exactly one lap', () => {
    const per = lapPerimeter(R);
    expect(lapPoint(R, per)).toEqual(lapPoint(R, 0));
    expect(lapPoint(R, 2 * per + 10)).toEqual(lapPoint(R, 10));
  });

  it('runs clockwise from the top-left corner, sides in order top, right, bottom, left', () => {
    const start = lapPoint(R, 0);
    expect(start).toMatchObject({ x: R.x, y: R.y, side: 'top' });
    expect(lapPoint(R, 200)).toMatchObject({ x: R.x + 200, y: R.y, side: 'top' });
    expect(lapPoint(R, 400 + 100)).toMatchObject({ x: RIGHT, y: R.y + 100, side: 'right' });
    expect(lapPoint(R, 400 + 300 + 100)).toMatchObject({ x: RIGHT - 100, y: BOTTOM, side: 'bottom' });
    expect(lapPoint(R, 400 + 300 + 400 + 100)).toMatchObject({ x: R.x, y: BOTTOM - 100, side: 'left' });
    const sides = [0, 500, 900, 1300].map((d) => lapPoint(R, d).side);
    expect(sides).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('keeps his feet on the outside edge of each side', () => {
    expect(lapPoint(R, 123).y).toBe(R.y);
    expect(lapPoint(R, 400 + 123).x).toBe(RIGHT);
    expect(lapPoint(R, 700 + 123).y).toBe(BOTTOM);
    expect(lapPoint(R, 1100 + 123).x).toBe(R.x);
  });

  it('facing follows travel', () => {
    expect(lapPoint(R, 200).facing).toBe(1);
    expect(lapPoint(R, 700 + 200).facing).toBe(-1);
    // Up the sides he keeps the facing of the edge he just turned off.
    expect(lapPoint(R, 400 + 100).facing).toBe(1);
    expect(lapPoint(R, 1100 + 100).facing).toBe(-1);
  });

  it('wraps negative distances back from the end of the lap', () => {
    expect(lapPoint(R, -100)).toEqual(lapPoint(R, lapPerimeter(R) - 100));
  });

  it('stays finite on a degenerate rect', () => {
    const p = lapPoint({ x: 10, y: 20, width: 0, height: 0 }, 50);
    expect(p).toMatchObject({ x: 10, y: 20, side: 'top', facing: 1 });
  });
});

describe('lapRect', () => {
  const AREA: Rect = { x: 0, y: 0, width: 1536, height: 816 };
  const ROOM = 48;

  it('is the window itself when there is room for him outside every side', () => {
    expect(lapRect(R, AREA, ROOM)).toEqual(R);
  });

  // Regression: laps round a maximised window ran along the screen edges with his body off-screen (seen in the M4 capture).
  it('pulls every side of a maximised window in, so he runs just inside its frame and stays on screen', () => {
    const loop = lapRect(AREA, AREA, ROOM);
    expect(loop).toEqual({ x: ROOM, y: ROOM, width: AREA.width - 2 * ROOM, height: AREA.height - 2 * ROOM });
    // His body sticks out ROOM past his feet on each side: up on the top, right on the right, and so on.
    const per = lapPerimeter(loop);
    for (let i = 0; i < 400; i++) {
      const p = lapPoint(loop, (i / 400) * per);
      const out = { top: [0, -ROOM], right: [ROOM, 0], bottom: [0, ROOM], left: [-ROOM, 0] }[p.side];
      const [ox = 0, oy = 0] = out;
      expect(p.x + ox).toBeGreaterThanOrEqual(AREA.x);
      expect(p.x + ox).toBeLessThanOrEqual(AREA.x + AREA.width);
      expect(p.y + oy).toBeGreaterThanOrEqual(AREA.y);
      expect(p.y + oy).toBeLessThanOrEqual(AREA.y + AREA.height);
    }
  });

  it('moves only the sides that lack room: a window pushed against the right edge', () => {
    const w: Rect = { x: 1000, y: 200, width: 536, height: 300 };
    expect(lapRect(w, AREA, ROOM)).toEqual({ x: 1000, y: 200, width: 536 - ROOM, height: 300 });
  });

  it('works for a work area that does not start at 0 (a second display, a top taskbar)', () => {
    const area: Rect = { x: 1536, y: 40, width: 1280, height: 680 };
    expect(lapRect(area, area, ROOM)).toEqual({ x: 1536 + ROOM, y: 40 + ROOM, width: 1280 - 2 * ROOM, height: 680 - 2 * ROOM });
  });

  it('never gives a negative size for a window too small to pull in', () => {
    const tiny: Rect = { x: 0, y: 0, width: 60, height: 60 };
    const loop = lapRect(tiny, AREA, ROOM);
    expect(loop.width).toBeGreaterThanOrEqual(0);
    expect(loop.height).toBeGreaterThanOrEqual(0);
  });
});

describe('digSpot', () => {
  it('is the top centre', () => {
    expect(digSpot(R)).toEqual({ x: R.x + R.width / 2, y: R.y });
  });
});

describe('hopPoint', () => {
  const from: Point = { x: 100, y: 400 };
  const to: Point = { x: 300, y: 400 };

  it('hop starts and ends exactly', () => {
    expect(hopPoint(from, to, 0)).toEqual(from);
    expect(hopPoint(from, to, 1)).toEqual(to);
    const mid = hopPoint(from, to, 0.5);
    expect(mid.y).toBeLessThan(from.y);
    expect(mid.y).toBeLessThan(to.y);
  });

  it('is linear in x', () => {
    expect(hopPoint(from, to, 0.25).x).toBeCloseTo(150, 9);
    expect(hopPoint(from, to, 0.5).x).toBeCloseTo(200, 9);
    expect(hopPoint(from, to, 0.75).x).toBeCloseTo(250, 9);
  });

  it('peaks HOP_HEIGHT above a level pair, halfway through', () => {
    expect(hopPoint(from, to, 0.5).y).toBeCloseTo(400 - HOP_HEIGHT, 9);
  });

  const peakOf = (a: Point, b: Point) => {
    let top = Infinity;
    for (let i = 0; i <= 10000; i++) top = Math.min(top, hopPoint(a, b, i / 10000).y);
    return top;
  };

  it('peaks HOP_HEIGHT above the higher end when hopping up onto a ledge', () => {
    const ledge: Point = { x: 300, y: 250 }; // y grows downward, so smaller y is higher
    expect(peakOf(from, ledge)).toBeCloseTo(250 - HOP_HEIGHT, 2);
    expect(hopPoint(from, ledge, 0)).toEqual(from);
    expect(hopPoint(from, ledge, 1)).toEqual(ledge);
  });

  it('peaks HOP_HEIGHT above the higher end when hopping down off a ledge', () => {
    const ledge: Point = { x: 100, y: 250 };
    const ground: Point = { x: 300, y: 400 };
    expect(peakOf(ledge, ground)).toBeCloseTo(250 - HOP_HEIGHT, 2);
  });

  it('never dips below the lower end', () => {
    const ledge: Point = { x: 300, y: 250 };
    for (let i = 0; i <= 100; i++) expect(hopPoint(from, ledge, i / 100).y).toBeLessThanOrEqual(400 + 1e-9);
  });

  it('clamps t to 0..1', () => {
    expect(hopPoint(from, to, -0.5)).toEqual(from);
    expect(hopPoint(from, to, 2)).toEqual(to);
  });

  it('does not mutate its inputs', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: 4 };
    hopPoint(a, b, 0);
    hopPoint(a, b, 1);
    expect(a).toEqual({ x: 1, y: 2 });
    expect(b).toEqual({ x: 3, y: 4 });
  });
});

describe('followDirection', () => {
  const plat = { x1: 200, x2: 800 };

  it('follow stays put in the dead zone', () => {
    expect(followDirection(500, 500, plat)).toBe(0);
    expect(followDirection(500, 510, plat)).toBe(0);
    expect(followDirection(500, 490, plat)).toBe(0);
    expect(followDirection(500, 500 + FOLLOW_DEADZONE, plat)).toBe(0);
    expect(followDirection(500, 500 - FOLLOW_DEADZONE, plat)).toBe(0);
  });

  it('walks towards the cursor once it is past the dead zone', () => {
    expect(followDirection(500, 500 + FOLLOW_DEADZONE + 1, plat)).toBe(1);
    expect(followDirection(500, 500 - FOLLOW_DEADZONE - 1, plat)).toBe(-1);
    expect(followDirection(500, 5000, plat)).toBe(1);
    expect(followDirection(500, -5000, plat)).toBe(-1);
  });

  it('never walks off its platform', () => {
    expect(followDirection(800, 2000, plat)).toBe(0);
    expect(followDirection(200, -2000, plat)).toBe(0);
    // Past the end already (the platform shrank under him): not walking further out.
    expect(followDirection(850, 2000, plat)).toBe(0);
    expect(followDirection(150, -2000, plat)).toBe(0);
  });

  it('still walks back along the platform from its ends or from past them', () => {
    expect(followDirection(800, 100, plat)).toBe(-1);
    expect(followDirection(200, 2000, plat)).toBe(1);
    expect(followDirection(850, 100, plat)).toBe(-1);
    expect(followDirection(150, 2000, plat)).toBe(1);
  });
});
