import { describe, expect, it } from 'vitest';
import {
  clipSprite,
  hiddenDisplayIds,
  MIN_PLATFORM_WIDTH,
  occludersFor,
  toDipWindows,
  visibleTopEdges,
  type DisplayInfo,
  type RawWindow,
  type Rect,
  type TrackedWindow,
} from '../../src/shared/geometry';

/** Same edge rounding Electron's screenToDipRect showed in the M0 spike (499,325,632x381 at 1.25 -> 399,260,506x305). */
const dipAt =
  (scale: number) =>
  (r: Rect): Rect => {
    const x = Math.round(r.x / scale);
    const y = Math.round(r.y / scale);
    return { x, y, width: Math.round((r.x + r.width) / scale) - x, height: Math.round((r.y + r.height) / scale) - y };
  };

const D1: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 824 },
  scaleFactor: 1.25,
};
const HEADROOM = 48;

const win = (id: number, x: number, y: number, width: number, height: number, over: Partial<TrackedWindow> = {}): TrackedWindow => ({
  id,
  bounds: { x, y, width, height },
  z: id,
  processName: 'app.exe',
  isForeground: false,
  fullscreen: false,
  ...over,
});
const edges = (ws: TrackedWindow[], ds: DisplayInfo[] = [D1]) => visibleTopEdges(ws, ds, HEADROOM);
const area = (rs: Rect[]) => rs.reduce((n, r) => n + r.width * r.height, 0);
const overlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('test helper', () => {
  it('dipAt(1.25) reproduces the spike Electron conversion', () => {
    expect(dipAt(1.25)({ x: 499, y: 325, width: 632, height: 381 })).toEqual({ x: 399, y: 260, width: 506, height: 305 });
  });
});

describe('toDipWindows', () => {
  const raw = (id: number, bounds: Rect, isForeground = false): RawWindow => ({ id, bounds, processName: 'a.exe', isForeground });

  it('assigns z in input order and marks fullscreen', () => {
    const out = toDipWindows(
      [raw(1, { x: 250, y: 125, width: 500, height: 250 }), raw(2, { x: 0, y: 0, width: 1920, height: 1080 })],
      dipAt(1.25),
      [D1],
    );
    expect(out.map((w) => [w.id, w.z, w.fullscreen])).toEqual([
      [1, 0, false],
      [2, 1, true],
    ]);
    expect(out[0]?.bounds).toEqual({ x: 200, y: 100, width: 400, height: 200 });
  });

  it('a maximised window (work area only) is not fullscreen', () => {
    const out = toDipWindows([raw(1, { x: 0, y: 0, width: 1920, height: 1030 })], dipAt(1.25), [D1]);
    expect(out[0]?.fullscreen).toBe(false);
  });

  it('drops non-finite and non-positive windows', () => {
    const ok = { x: 100, y: 100, width: 300, height: 200 };
    const out = toDipWindows(
      [
        raw(1, { ...ok, width: 0 }),
        raw(2, { ...ok, height: -5 }),
        raw(3, { ...ok, x: Number.NaN }),
        raw(4, { ...ok, y: Number.POSITIVE_INFINITY }),
        raw(5, ok),
        raw(6, { x: -32000, y: -32000, width: 160, height: 28 }),
        raw(7, ok),
      ],
      dipAt(1),
      [D1],
    );
    expect(out.map((w) => [w.id, w.z])).toEqual([
      [5, 0],
      [7, 1],
    ]);
  });
});

describe('visibleTopEdges', () => {
  it('overlapping stack: lower window edge is cut where the upper one covers it', () => {
    const p = edges([win(1, 100, 100, 400, 300), win(2, 300, 200, 500, 300)]);
    expect(p).toContainEqual({ windowId: 1, displayId: 1, x1: 100, x2: 500, y: 100, originX: 100 });
    expect(p).toContainEqual({ windowId: 2, displayId: 1, x1: 500, x2: 800, y: 200, originX: 300 });
    expect(p).toContainEqual({ windowId: null, displayId: 1, x1: 0, x2: 1536, y: 824, originX: 0 });
  });

  it('a window above does not cut a window whose edge it does not cover vertically', () => {
    const p = edges([win(1, 100, 300, 400, 100), win(2, 300, 200, 500, 300)]);
    expect(p.filter((q) => q.windowId === 2)).toEqual([{ windowId: 2, displayId: 1, x1: 300, x2: 800, y: 200, originX: 300 }]);
  });

  it('maximised window top edge clamps to headroom', () => {
    const p = edges([win(1, 0, 0, 1536, 824)]);
    expect(p).toContainEqual({ windowId: 1, displayId: 1, x1: 0, x2: 1536, y: HEADROOM, originX: 0 });
  });

  it('edge segments shorter than MIN_PLATFORM_WIDTH are dropped', () => {
    // Window 2 (above) covers window 1's top edge (x 100..200) up to x=169, leaving a 31 px sliver.
    const p = edges([win(1, 100, 200, 100, 300), win(2, 50, 150, 119, 300, { z: 0 })]);
    expect(200 - 169).toBeLessThan(MIN_PLATFORM_WIDTH);
    expect(p.filter((q) => q.windowId === 1)).toEqual([]);
    expect(p.filter((q) => q.windowId === 2)).toHaveLength(1);
  });

  it('window partly off-screen is clipped to the work area', () => {
    const p = edges([win(1, -200, 300, 500, 200)]);
    expect(p).toContainEqual({ windowId: 1, displayId: 1, x1: 0, x2: 300, y: 300, originX: -200 });
  });

  it('a window on a display above does not leak a platform onto this one', () => {
    const top: DisplayInfo = { ...D1, id: 2, bounds: { x: 0, y: -864, width: 1536, height: 864 }, workArea: { x: 0, y: -864, width: 1536, height: 824 } };
    const p = edges([win(1, 100, -600, 400, 300)], [D1, top]);
    expect(p.filter((q) => q.windowId === 1).map((q) => q.displayId)).toEqual([2]);
  });

  it('fullscreen windows give no platform', () => {
    const p = edges([win(1, 0, 0, 1536, 864, { fullscreen: true })]);
    expect(p).toEqual([{ windowId: null, displayId: 1, x1: 0, x2: 1536, y: 824, originX: 0 }]);
  });

  it.each([1, 1.25, 1.5])('platform y matches the window top at scale %s', (scale) => {
    const toDip = dipAt(scale);
    const display: DisplayInfo = {
      id: 1,
      bounds: toDip({ x: 0, y: 0, width: 1920, height: 1080 }),
      workArea: toDip({ x: 0, y: 0, width: 1920, height: 1040 }),
      scaleFactor: scale,
    };
    const phys: RawWindow = { id: 9, bounds: { x: 301, y: 457, width: 801, height: 503 }, processName: 'a.exe', isForeground: true };
    const [w] = toDipWindows([phys], toDip, [display]);
    const p = visibleTopEdges(w ? [w] : [], [display], HEADROOM).find((q) => q.windowId === 9);
    expect(p?.y).toBe(toDip(phys.bounds).y);
    expect(p?.x1).toBe(toDip(phys.bounds).x);
  });
});

describe('hiddenDisplayIds', () => {
  it('fullscreen foreground hides its display', () => {
    expect(hiddenDisplayIds([win(1, 0, 0, 1536, 864, { fullscreen: true, isForeground: true })], [D1])).toEqual(new Set([1]));
  });
  it('a fullscreen window that is not foreground hides nothing', () => {
    expect(hiddenDisplayIds([win(1, 0, 0, 1536, 864, { fullscreen: true })], [D1]).size).toBe(0);
  });
  it('a foreground window that is not fullscreen hides nothing', () => {
    expect(hiddenDisplayIds([win(1, 0, 0, 1536, 824, { isForeground: true })], [D1]).size).toBe(0);
  });
});

describe('occludersFor', () => {
  const ws = [win(1, 0, 0, 10, 10), win(2, 5, 5, 10, 10), win(3, 9, 9, 10, 10)];
  it('returns the rects of windows above the target', () => {
    expect(occludersFor(3, ws)).toEqual([ws[0]?.bounds, ws[1]?.bounds]);
    expect(occludersFor(1, ws)).toEqual([]);
  });
  it('the floor is covered by every window', () => {
    expect(occludersFor(null, ws)).toHaveLength(3);
  });
});

describe('clipSprite', () => {
  const sprite: Rect = { x: 0, y: 0, width: 64, height: 48 };
  it('no occluders leaves the sprite whole', () => {
    expect(clipSprite(sprite, [])).toEqual([sprite]);
  });
  it('an occluder over the right half leaves the left half', () => {
    expect(clipSprite(sprite, [{ x: 32, y: -10, width: 100, height: 100 }])).toEqual([{ x: 0, y: 0, width: 32, height: 48 }]);
  });
  it('a middle occluder leaves non-overlapping pieces that miss it', () => {
    const o: Rect = { x: 20, y: 10, width: 10, height: 10 };
    const pieces = clipSprite(sprite, [o]);
    expect(area(pieces)).toBe(64 * 48 - 100);
    pieces.forEach((p, i) => {
      expect(overlap(p, o)).toBe(false);
      pieces.slice(i + 1).forEach((q) => expect(overlap(p, q)).toBe(false));
    });
  });
  it('a fully covered sprite leaves nothing', () => {
    expect(clipSprite(sprite, [{ x: -5, y: -5, width: 200, height: 200 }])).toEqual([]);
  });
});
