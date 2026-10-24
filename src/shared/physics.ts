import type { DisplayInfo, Platform } from './geometry';

/** Sprite footprint in DIP. `DogBody.x` is the centre of the feet and `y` the feet line. */
export const DOG = { width: 64, height: 48 };

export const GRAVITY = 0.0025; // px/ms²
export const MAX_FALL_SPEED = 1.5; // px/ms
export const WALK_SPEED = 0.06; // px/ms
export const REDUCED_WALK_SPEED = 0.03; // px/ms
/** Larger frame gaps (a stalled main thread, a long sleep) are treated as this long. */
export const MAX_STEP_MS = 50;

const EPS = 1e-6;

export type Walk = -1 | 0 | 1;

/** What the dog stands on. `dx` is feet x minus the platform's `originX`, so it rides along with a moving window. */
export interface Anchor {
  windowId: number | null;
  displayId: number;
  dx: number;
}

export interface DogBody {
  x: number;
  y: number;
  vy: number;
  facing: 1 | -1;
  anchor: Anchor | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function anchoredTo(p: Platform, platformId: Anchor): boolean {
  return p.windowId === platformId.windowId && p.displayId === platformId.displayId;
}

function anchorTo(p: Platform, x: number): Anchor {
  return { windowId: p.windowId, displayId: p.displayId, dx: x - p.originX };
}

function floorFor(platforms: readonly Platform[], displays: readonly DisplayInfo[], x: number): Platform | null {
  const floors: Platform[] = platforms.filter((p) => p.windowId === null);
  if (floors.length === 0) {
    for (const d of displays) {
      const wa = d.workArea;
      floors.push({ windowId: null, displayId: d.id, x1: wa.x, x2: wa.x + wa.width, y: wa.y + wa.height, originX: wa.x });
    }
  }
  let best: Platform | null = null;
  let bestDist = Infinity;
  for (const f of floors) {
    const dist = x < f.x1 ? f.x1 - x : x > f.x2 ? x - f.x2 : 0;
    if (dist < bestDist) {
      best = f;
      bestDist = dist;
    }
  }
  return best;
}

/** Puts the dog on the floor nearest to its x, clamped inside that floor. */
function respawn(dog: DogBody, platforms: readonly Platform[], displays: readonly DisplayInfo[]): DogBody {
  const floor = floorFor(platforms, displays, dog.x);
  if (!floor) return { ...dog, vy: 0, anchor: null };
  const x = clamp(Number.isFinite(dog.x) ? dog.x : floor.x1, floor.x1, floor.x2);
  return { x, y: floor.y, vy: 0, facing: dog.facing, anchor: anchorTo(floor, x) };
}

export function spawnDog(platforms: readonly Platform[], displays: readonly DisplayInfo[]): DogBody {
  const first = displays[0];
  const floor = platforms.find((p) => p.windowId === null && (!first || p.displayId === first.id)) ?? floorFor(platforms, displays, 0);
  if (!floor) return { x: 0, y: 0, vy: 0, facing: 1, anchor: null };
  const x = (floor.x1 + floor.x2) / 2;
  return { x, y: floor.y, vy: 0, facing: 1, anchor: anchorTo(floor, x) };
}

function fall(dog: DogBody, platforms: readonly Platform[], displays: readonly DisplayInfo[], dt: number): DogBody {
  const below = platforms.filter((p) => dog.x >= p.x1 && dog.x <= p.x2 && p.y >= dog.y - EPS);
  if (below.length === 0) return respawn(dog, platforms, displays);
  const vy = Math.min(MAX_FALL_SPEED, dog.vy + GRAVITY * dt);
  const y = dog.y + vy * dt;
  // Swept landing test: take the highest platform the feet crossed this step.
  const landing = below.filter((p) => p.y <= y).sort((a, b) => a.y - b.y)[0];
  if (landing) return { x: dog.x, y: landing.y, vy: 0, facing: dog.facing, anchor: anchorTo(landing, dog.x) };
  return { ...dog, y, vy, anchor: null };
}

/**
 * Advances the dog by `dtMs` (clamped to 0..MAX_STEP_MS). Anchored: follows its platform and walks along it,
 * stopping at the ends. If the platform is gone the dog falls and lands on the next one below; if nothing is
 * below it, it is put back on the nearest floor.
 */
export function stepDog(
  dog: DogBody,
  platforms: readonly Platform[],
  displays: readonly DisplayInfo[],
  dtMs: number,
  walk: Walk,
  speed: number = WALK_SPEED,
): DogBody {
  const dt = Number.isFinite(dtMs) ? clamp(dtMs, 0, MAX_STEP_MS) : 0;
  const facing = walk === 0 ? dog.facing : walk;
  if (dog.anchor) {
    const anchor = dog.anchor;
    const same = platforms.filter((p) => anchoredTo(p, anchor));
    const origin = same[0]?.originX;
    const x0 = origin === undefined ? dog.x : origin + anchor.dx;
    const segment = same.find((p) => x0 >= p.x1 - EPS && x0 <= p.x2 + EPS);
    if (segment) {
      const x = clamp(x0 + walk * speed * dt, segment.x1, segment.x2);
      return { x, y: segment.y, vy: 0, facing, anchor: anchorTo(segment, x) };
    }
    return fall({ ...dog, x: x0, vy: 0, facing, anchor: null }, platforms, displays, dt);
  }
  return fall({ ...dog, facing }, platforms, displays, dt);
}

/** -1 / 1 when the anchored dog is at the left / right end of its segment, else 0. */
export function edgeContact(dog: DogBody, platforms: readonly Platform[]): Walk {
  const anchor = dog.anchor;
  if (!anchor) return 0;
  const segment = platforms.find((p) => anchoredTo(p, anchor) && dog.x >= p.x1 - EPS && dog.x <= p.x2 + EPS);
  if (!segment) return 0;
  if (dog.x <= segment.x1 + EPS) return -1;
  if (dog.x >= segment.x2 - EPS) return 1;
  return 0;
}
