import { nextFloat, nextInt, type RngState } from '../engine/rng';
import type { Walk } from './physics';

/** What the dog does while nothing else is going on: sit, or walk one way, until `untilMs`. */
export interface RoamState {
  walk: Walk;
  untilMs: number;
}

const SIT_CHANCE = 0.4;
const SIT_MS = [3000, 10_000] as const;
const WALK_MS = [2000, 6000] as const;

/**
 * Picks the next roaming action once `untilMs` has passed. Walking into the edge turns the dog around
 * (same `untilMs`), and a new walk never heads into the edge the dog is already standing on.
 */
export function roamStep(s: RoamState, nowMs: number, atEdge: Walk, rng: RngState): [RoamState, RngState] {
  if (atEdge !== 0 && s.walk === atEdge) return [{ walk: (-atEdge) as Walk, untilMs: s.untilMs }, rng];
  if (nowMs < s.untilMs) return [s, rng];

  const [roll, r1] = nextFloat(rng);
  if (roll < SIT_CHANCE) {
    const [ms, r2] = nextInt(r1, SIT_MS[0], SIT_MS[1]);
    return [{ walk: 0, untilMs: nowMs + ms }, r2];
  }
  const [dirRoll, r2] = nextFloat(r1);
  let walk: Walk = dirRoll < 0.5 ? -1 : 1;
  if (walk === atEdge) walk = (-walk) as Walk;
  const [ms, r3] = nextInt(r2, WALK_MS[0], WALK_MS[1]);
  return [{ walk, untilMs: nowMs + ms }, r3];
}
