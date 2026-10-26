import type { Platform, Rect } from './geometry';
import type { LapSide } from './ipc';

export interface Point {
  x: number;
  y: number;
}

export const LAP_SPEED = 0.45; // px/ms, how fast he runs round a window
export const HOP_MS = 600; // one hop from the floor up to a window edge, or back down
export const HOP_HEIGHT = 60; // px the arc peaks above the higher end of a hop
/** Follow mode: the cursor must be further than this from his feet before he walks to it. */
export const FOLLOW_DEADZONE = 24; // px

export function lapPerimeter(rect: Rect): number {
  return 2 * (rect.width + rect.height);
}

/**
 * Where he is `distance` px into a lap round `rect`. Clockwise from the top-left corner, wrapping every perimeter,
 * with his feet on the outside edge. `facing` is his horizontal heading: right along the top, left along the bottom,
 * and on the sides he keeps the heading of the edge he just turned off.
 */
export function lapPoint(rect: Rect, distance: number): { x: number; y: number; side: LapSide; facing: 1 | -1 } {
  const { x, y, width: w, height: h } = rect;
  const perimeter = lapPerimeter(rect);
  if (perimeter <= 0) return { x, y, side: 'top', facing: 1 };

  const d = ((distance % perimeter) + perimeter) % perimeter;
  if (d < w) return { x: x + d, y, side: 'top', facing: 1 };
  if (d < w + h) return { x: x + w, y: y + (d - w), side: 'right', facing: 1 };
  if (d < 2 * w + h) return { x: x + w - (d - w - h), y: y + h, side: 'bottom', facing: -1 };
  return { x, y: y + h - (d - 2 * w - h), side: 'left', facing: -1 };
}

/**
 * The loop he runs round a window: its frame, except that a side with less than `room` px between it and the edge of
 * `area` (a maximised or snapped window, or one pushed against the screen edge) is pulled in by that much, so he runs just
 * inside the frame there instead of off-screen. `room` is how far his body sticks out past his feet (his height).
 */
export function lapRect(rect: Rect, area: Rect, room: number): Rect {
  const x1 = Math.max(rect.x, area.x + room);
  const y1 = Math.max(rect.y, area.y + room);
  const x2 = Math.min(rect.x + rect.width, area.x + area.width - room);
  const y2 = Math.min(rect.y + rect.height, area.y + area.height - room);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

/** Where he sits to dig in: the centre of the window's top edge. */
export function digSpot(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y };
}

/**
 * A hop from `from` to `to`, `t` in 0..1 (clamped). x is linear; y follows a parabola that peaks exactly
 * `HOP_HEIGHT` above the higher end (smaller y is higher), so a hop up onto a ledge still clears it.
 */
export function hopPoint(from: Point, to: Point, t: number): Point {
  if (!(t > 0)) return { x: from.x, y: from.y };
  if (t >= 1) return { x: to.x, y: to.y };

  const x = from.x + (to.x - from.x) * t;

  // y(t) = peak + c * (t - tPeak)^2, through both ends. With H the rise above the higher end and D the height
  // difference between the ends, the higher end sits H above the lowest point and the lower end H + D, which
  // pins tPeak and c. Both are measured from the higher end, so mirror them when the hop starts at the lower one.
  const fromIsHigher = from.y <= to.y;
  const higher = fromIsHigher ? from.y : to.y;
  const drop = Math.abs(to.y - from.y);
  const nearShare = Math.sqrt(HOP_HEIGHT) / (Math.sqrt(HOP_HEIGHT) + Math.sqrt(HOP_HEIGHT + drop));
  const tPeak = fromIsHigher ? nearShare : 1 - nearShare;
  const c = HOP_HEIGHT / (nearShare * nearShare);
  const y = higher - HOP_HEIGHT + c * (t - tPeak) * (t - tPeak);

  return { x, y };
}

/**
 * Which way he walks to follow the cursor. 0 inside the dead zone, and 0 when walking on would take him further
 * out of `x1..x2` than he already is; he can always walk back towards the platform.
 */
export function followDirection(dogX: number, cursorX: number, platform: Pick<Platform, 'x1' | 'x2'>): -1 | 0 | 1 {
  const dx = cursorX - dogX;
  if (Math.abs(dx) <= FOLLOW_DEADZONE) return 0;
  if (dx < 0) return dogX <= platform.x1 ? 0 : -1;
  return dogX >= platform.x2 ? 0 : 1;
}
