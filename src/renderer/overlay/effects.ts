import { LAP_SPEED, lapPerimeter, lapPoint, type Point } from '../../shared/behaviour';
import type { Rect } from '../../shared/geometry';
import type { DogFrame, LapSide } from '../../shared/ipc';

/** Paw prints fade out over this long once the laps that left them are over. */
export const PRINT_FADE_MS = 1500;
const PRINT_SPACING = 44; // px of lap between two prints
const PRINT_TRAIL = 32; // the newest prints kept; older ones are not drawn, so a long lap stays cheap
const PRINT_SIDE_OFFSET = 2.5; // px either side of the line, left and right paws alternating

const DIRT_COUNT = 14;
const DIRT_LIFE_MS = 600; // one throw, from his paws to fading out
const DIRT_GRAVITY = 0.0008; // px/ms²

/** The rotation that turns something drawn facing +x to face along a lap on this side (laps run clockwise). */
export const SIDE_HEADING: Record<LapSide, number> = { top: 0, right: Math.PI / 2, bottom: Math.PI, left: -Math.PI / 2 };

/** A number in 0..1 from a seed and two counters. Pure, so the same seed and time always draw the same dirt and prints. */
function rand(seed: number, a: number, b = 0): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Dirt thrown up while he digs in, worked out directly from the seed and the time (no state): a stream of particles,
 * each thrown up and sideways, pulled down by gravity and fading as it falls. Under reduced motion it is one still spray.
 */
export function dirtParticles(
  seed: number,
  elapsedMs: number,
  origin: Point,
  reducedMotion: boolean,
): { x: number; y: number; size: number; alpha: number }[] {
  const t = reducedMotion ? DIRT_LIFE_MS * 2 : Math.max(0, elapsedMs);
  const out: { x: number; y: number; size: number; alpha: number }[] = [];
  for (let i = 0; i < DIRT_COUNT; i++) {
    const sinceThrown = t - i * (DIRT_LIFE_MS / DIRT_COUNT); // particles are thrown one after another
    if (sinceThrown < 0) continue;
    const throwNo = Math.floor(sinceThrown / DIRT_LIFE_MS);
    const age = sinceThrown - throwNo * DIRT_LIFE_MS;
    const r = (n: number) => rand(seed, i * 4 + n, throwNo);
    const vx = (r(0) < 0.5 ? -1 : 1) * (0.05 + r(1) * 0.12);
    const vy = -(0.12 + r(2) * 0.1);
    out.push({
      x: origin.x + vx * age,
      y: origin.y + vy * age + 0.5 * DIRT_GRAVITY * age * age,
      size: 2 + r(3) * 3,
      alpha: 1 - age / DIRT_LIFE_MS,
    });
  }
  return out;
}

/**
 * Prints laid round `rect` behind him as he runs laps, a left and a right paw alternating about the line of the frame.
 * `angle` is the way he was heading (a print is drawn with its toes along +x, rotated by it). `elapsedMs` is how long
 * the laps ran (frozen at its last value once they end), `fadeMs` how long since they ended (0 while they run), and
 * `from` how far round the frame the lap began.
 */
export function pawPrints(
  seed: number,
  rect: Rect,
  elapsedMs: number,
  fadeMs: number,
  from = 0,
): { x: number; y: number; angle: number; alpha: number }[] {
  if (lapPerimeter(rect) <= 0) return [];
  const alpha = Math.min(Math.max(1 - fadeMs / PRINT_FADE_MS, 0), 1);
  const newest = Math.floor((Math.max(0, elapsedMs) * LAP_SPEED) / PRINT_SPACING);
  const out: { x: number; y: number; angle: number; alpha: number }[] = [];
  for (let k = Math.max(1, newest - PRINT_TRAIL + 1); k <= newest; k++) {
    const p = lapPoint(rect, from + k * PRINT_SPACING);
    const heading = SIDE_HEADING[p.side];
    const offset = (k % 2 === 0 ? -1 : 1) * (PRINT_SIDE_OFFSET - 0.5 + rand(seed, k)); // 2..3 px, alternating sides
    out.push({
      x: p.x - Math.sin(heading) * offset,
      y: p.y + Math.cos(heading) * offset,
      angle: heading,
      alpha,
    });
  }
  return out;
}

/** How far round the frame a lap began, worked back from where he is now (`lapPoint` the other way) and how long he has run. */
export function lapOrigin(rect: Rect, at: Point, side: LapSide, elapsedMs: number): number {
  const { x, y, width: w, height: h } = rect;
  const now =
    side === 'top' ? at.x - x : side === 'right' ? w + (at.y - y) : side === 'bottom' ? w + h + (x + w - at.x) : 2 * w + h + (y + h - at.y);
  return now - LAP_SPEED * elapsedMs;
}

/**
 * Whether the overlay needs a `requestAnimationFrame` loop. Frames arrive from main while he walks or moves, so an
 * idle sitting dog costs nothing; the loop is only for what moves between frames: an effect, a run or hop, a happy
 * spin and wag, or a fade. Under reduced motion only a fade in progress still runs.
 */
export function needsAnimation(frame: DogFrame | null, fading: boolean, reducedMotion: boolean): boolean {
  if (fading) return true;
  if (!frame || reducedMotion) return false;
  return frame.effect !== undefined || frame.pose === 'run' || frame.pose === 'hop' || frame.mood === 'happy' || frame.mood === 'ecstatic';
}
