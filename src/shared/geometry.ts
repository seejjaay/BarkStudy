export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** DIP rectangles. `workArea` excludes the taskbar. */
export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
}

/** A window as the tracker reads it: physical pixels, z-order top first. */
export interface RawWindow {
  id: number;
  bounds: Rect;
  processName: string;
  isForeground: boolean;
}

/** DIP bounds; `z` 0 is the top of the stack. */
export interface TrackedWindow {
  id: number;
  bounds: Rect;
  z: number;
  processName: string;
  isForeground: boolean;
  fullscreen: boolean;
}

/**
 * A walkable segment: a window's visible top edge, or a display's floor (`windowId` null).
 * `originX` is the window's left edge (the work area's left edge for floors); a dog anchored with
 * `dx = x - originX` rides along when the window moves.
 */
export interface Platform {
  windowId: number | null;
  displayId: number;
  x1: number;
  x2: number;
  y: number;
  originX: number;
}

export const MIN_PLATFORM_WIDTH = 32;

/** Tolerance when deciding that a window covers a whole display (DIP rounding). */
const COVER_SLACK = 1;

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const finiteRect = (r: Rect) =>
  Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0;
const intersects = (a: Rect, b: Rect) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
const covers = (r: Rect, d: DisplayInfo) =>
  r.x <= d.bounds.x + COVER_SLACK &&
  r.y <= d.bounds.y + COVER_SLACK &&
  right(r) >= right(d.bounds) - COVER_SLACK &&
  bottom(r) >= bottom(d.bounds) - COVER_SLACK;

/**
 * Converts physical-pixel windows to DIP and drops anything unusable: non-finite or empty bounds
 * (before and after conversion) and windows that touch no display (e.g. the -32000 parking spot).
 */
export function toDipWindows(raw: readonly RawWindow[], toDip: (r: Rect) => Rect, displays: readonly DisplayInfo[]): TrackedWindow[] {
  const out: TrackedWindow[] = [];
  for (const r of raw) {
    if (!finiteRect(r.bounds)) continue;
    const bounds = toDip(r.bounds);
    if (!finiteRect(bounds) || !displays.some((d) => intersects(bounds, d.bounds))) continue;
    out.push({
      id: r.id,
      bounds,
      z: out.length,
      processName: r.processName,
      isForeground: r.isForeground,
      fullscreen: displays.some((d) => covers(bounds, d)),
    });
  }
  return out;
}

/** Removes the parts of [x1, x2) that any occluder covers at height `y`. */
function uncovered(x1: number, x2: number, y: number, occluders: readonly Rect[]): [number, number][] {
  let segments: [number, number][] = [[x1, x2]];
  for (const o of occluders) {
    if (y < o.y || y >= bottom(o)) continue;
    const a = o.x;
    const b = right(o);
    segments = segments.flatMap(([s, e]): [number, number][] => {
      if (b <= s || a >= e) return [[s, e]];
      const kept: [number, number][] = [];
      if (a > s) kept.push([s, a]);
      if (b < e) kept.push([b, e]);
      return kept;
    });
  }
  return segments;
}

/**
 * Every spot the dog can stand: each display's floor, plus the part of each window's top edge that no
 * window above covers. A top edge nearer than `headroom` to the work-area top (maximised windows) is
 * lowered to `workArea.y + headroom` so the dog stays on screen. Fullscreen windows give no platform.
 */
export function visibleTopEdges(windows: readonly TrackedWindow[], displays: readonly DisplayInfo[], headroom: number): Platform[] {
  const platforms: Platform[] = [];
  const byZ = [...windows].sort((a, b) => a.z - b.z);
  for (const d of displays) {
    const wa = d.workArea;
    const floorY = bottom(wa);
    for (const w of byZ) {
      if (w.fullscreen) continue;
      const wb = w.bounds;
      if (wb.y >= floorY || bottom(wb) <= wa.y) continue;
      const y = Math.max(wb.y, wa.y + headroom);
      if (y >= bottom(wb) || y >= floorY) continue;
      const x1 = Math.max(wb.x, wa.x);
      const x2 = Math.min(right(wb), right(wa));
      if (x2 <= x1) continue;
      for (const [s, e] of uncovered(x1, x2, y, occludersFor(w.id, windows))) {
        if (e - s >= MIN_PLATFORM_WIDTH) platforms.push({ windowId: w.id, displayId: d.id, x1: s, x2: e, y, originX: wb.x });
      }
    }
    platforms.push({ windowId: null, displayId: d.id, x1: wa.x, x2: right(wa), y: floorY, originX: wa.x });
  }
  return platforms;
}

/** Windows drawn above the given one; every window for the floor (`null`) or an unknown id. */
export function occludersFor(windowId: number | null, windows: readonly TrackedWindow[]): Rect[] {
  const target = windowId === null ? undefined : windows.find((w) => w.id === windowId);
  return windows.filter((w) => (target ? w.z < target.z : true)).map((w) => w.bounds);
}

/** The visible pieces of `sprite` after cutting out every occluder. */
export function clipSprite(sprite: Rect, occluders: readonly Rect[]): Rect[] {
  let pieces: Rect[] = [sprite];
  for (const o of occluders) {
    pieces = pieces.flatMap((p) => {
      if (!intersects(p, o)) return [p];
      const kept: Rect[] = [];
      const oy1 = Math.max(o.y, p.y);
      const oy2 = Math.min(bottom(o), bottom(p));
      if (o.y > p.y) kept.push({ x: p.x, y: p.y, width: p.width, height: o.y - p.y });
      if (bottom(o) < bottom(p)) kept.push({ x: p.x, y: bottom(o), width: p.width, height: bottom(p) - bottom(o) });
      if (o.x > p.x) kept.push({ x: p.x, y: oy1, width: o.x - p.x, height: oy2 - oy1 });
      if (right(o) < right(p)) kept.push({ x: right(o), y: oy1, width: right(p) - right(o), height: oy2 - oy1 });
      return kept;
    });
  }
  return pieces;
}

/** Displays where a fullscreen window is in front: the dog stays hidden there. */
export function hiddenDisplayIds(windows: readonly TrackedWindow[], displays: readonly DisplayInfo[]): Set<number> {
  const hidden = new Set<number>();
  for (const d of displays) {
    if (windows.some((w) => w.fullscreen && w.isForeground && covers(w.bounds, d))) hidden.add(d.id);
  }
  return hidden;
}
