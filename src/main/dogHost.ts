import { createRng, nextInt, type RngState } from '../engine/rng';
import { DEFAULT_TUNING } from '../engine/tuning';
import type { Action } from '../engine/types';
import { digSpot, followDirection, HOP_MS, hopPoint, LAP_SPEED, lapPoint, type Point } from '../shared/behaviour';
import {
  clipSprite,
  hiddenDisplayIds,
  occludersFor,
  visibleTopEdges,
  type DisplayInfo,
  type Platform,
  type Rect,
  type TrackedWindow,
} from '../shared/geometry';
import type { DogFrame, DogPose, LapSide } from '../shared/ipc';
import { MOOD_HOLD_MS, moodFromExpression, type Mood } from '../shared/mood';
import {
  DOG,
  edgeContact,
  REDUCED_WALK_SPEED,
  spawnDog,
  stepDog,
  WALK_SPEED,
  type DogBody,
  type Walk,
} from '../shared/physics';
import { roamStep, type RoamState } from '../shared/roam';

export const TICK_MS = 16;
/** After the world changes, keep ticking this long so the dog follows a moving window or lands. */
export const SETTLE_MS = 250;
/** Effects stop by themselves this long after their max, whether or not END_EFFECT comes. */
export const EFFECT_GRACE_MS = 500;
/** sulkAfter(): how long the answer's own mood shows before he sulks. */
export const SULK_DELAY_MS = 1500;

/** The engine actions that move him. */
export type DogAction = Extract<Action, { type: 'WALK_TO' | 'RUN_LAPS' | 'START_DIG_IN' | 'END_EFFECT' | 'CURL_UP' }>;
export type DogBehaviour = 'roam' | 'follow' | 'hop' | 'laps' | 'dig' | 'curl' | 'sit-stay';

export interface FrameSink {
  send: (displayId: number, frame: DogFrame | null) => void;
}

export interface Clock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface DogHostOptions {
  seed: number;
  sink: FrameSink;
  clock?: Clock;
  /** The cursor in DIP screen coordinates. Read only while he follows it. */
  cursor?: () => Point | null;
  /** An effect's window is gone or hidden, or an effect could not start: the engine should end it. Always called from a tick, never from inside a DogHost method. */
  onEffectLost?: () => void;
  effectMaxMs?: { laps: number; dig: number };
}

export interface DogHost {
  setWorld: (windows: readonly TrackedWindow[], displays: readonly DisplayInfo[]) => void;
  /** The tracker failed: ignore windows from now on and roam the display edges. */
  setTrackerDown: () => void;
  setReducedMotion: (on: boolean) => void;
  /** Debug/e2e: with roaming off the dog only sits, so tests are not disturbed by random walks. */
  setRoaming: (on: boolean) => void;
  /** Debug/e2e: stand the dog on that window's widest visible top edge. */
  placeOn: (windowId: number) => boolean;
  /** Plays an engine action. An effect on a window he cannot reach does not start, and is reported through onEffectLost. */
  perform: (action: DogAction) => void;
  /** The engine's expression. Short moods drop back to idle by themselves (MOOD_HOLD_MS); pleading and follow-cursor make him follow the cursor. */
  setMood: (name: string) => void;
  /** An answer that came with a guilt trip: the current mood for SULK_DELAY_MS, then a sulk, then idle. */
  sulkAfter: () => void;
  /** A Stay: he ends any effect and sits where he is until it is lifted. */
  setStay: (on: boolean) => void;
  readonly behaviour: DogBehaviour;
  readonly mode: 'tracking' | 'edge-roaming';
  body: () => DogBody;
  dispose: () => void;
}

interface Effect {
  kind: 'laps' | 'dig';
  windowId: number;
  seed: number;
  /** How long it has run, summed from forward clock steps only: a wall-clock jump back cannot stretch it. */
  elapsed: number;
  /** It stops by itself when `elapsed` gets here. */
  limit: number;
  /** Laps: he had run `from` px round the window when `elapsed` was `at`. */
  lap: { from: number; at: number };
}

/** A hop onto a window's top edge. The landing spot is kept relative to the window, so it moves with it. */
interface Hop {
  windowId: number;
  from: Point;
  landDx: number;
  elapsed: number;
}

/** The mood that goes with an effect: set when it starts, cleared when it ends. */
const EFFECT_MOOD: Record<Effect['kind'], Mood> = { laps: 'zoomies', dig: 'dig' };
const EPS = 1e-6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const follows = (m: Mood) => m === 'pleading' || m === 'follow-cursor';

/** How far (x, y) is outside `r`; 0 inside or on its edge. */
function distanceOutside(r: Rect, x: number, y: number): number {
  return Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.width)), Math.max(r.y - y, 0, y - (r.y + r.height)));
}

/** The sprite's box for feet at (x, y). On laps he is turned so his feet are on the window's edge and his back faces outward. */
function spriteRect(x: number, y: number, side: LapSide | undefined): Rect {
  const { width: w, height: h } = DOG;
  switch (side) {
    case 'right':
      return { x, y: y - w / 2, width: h, height: w };
    case 'bottom':
      return { x: x - w / 2, y, width: w, height: h };
    case 'left':
      return { x: x - h, y: y - w / 2, width: h, height: w };
    default:
      return { x: x - w / 2, y: y - h, width: w, height: h };
  }
}

/** The visible piece of a window's top edge nearest to `x`. */
function nearestSegment(platforms: readonly Platform[], windowId: number, x: number): Platform | undefined {
  let best: Platform | undefined;
  let bestDist = Infinity;
  for (const p of platforms) {
    if (p.windowId !== windowId) continue;
    const dist = x < p.x1 ? p.x1 - x : x > p.x2 ? x - p.x2 : 0;
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createDogHost(opts: DogHostOptions): DogHost {
  const clock = opts.clock ?? systemClock;
  const effectMax = opts.effectMaxMs ?? { laps: DEFAULT_TUNING.lapsMaxMs, dig: DEFAULT_TUNING.digInMaxMs };
  let mode: 'tracking' | 'edge-roaming' = 'tracking';
  let windows: readonly TrackedWindow[] = [];
  let displays: readonly DisplayInfo[] = [];
  let platforms: Platform[] = [];
  let hidden = new Set<number>();
  let body: DogBody | null = null;
  let roam: RoamState = { walk: 0, untilMs: 0 };
  let rng: RngState = createRng(opts.seed);
  let reducedMotion = false;
  let roaming = true;
  let timer: unknown = null;
  let lastTick = clock.now();
  let settleUntil = 0;
  let shownOn: number | null = null;
  let lastSent: string | null = null;
  let disposed = false;
  let behaviour: DogBehaviour = 'roam';
  let mood: Mood = 'idle';
  /** Mood changes still to come, earliest first: a short mood's fallback to idle, or the steps of sulkAfter(). */
  let moodPlan: { at: number; mood: Mood }[] = [];
  let effect: Effect | null = null;
  let hop: Hop | null = null;
  /** Which edge of the window he is on, during laps. */
  let side: LapSide | undefined;
  let followWalk: Walk = 0;
  /** An effect was lost or refused: onEffectLost fires from the next tick, so it never re-enters the caller of perform(). */
  let lostPending = false;

  function rebuild(): void {
    platforms = visibleTopEdges(windows, displays, DOG.height);
    hidden = hiddenDisplayIds(windows, displays);
  }

  /** Anchored, the display his platform is on; otherwise the one holding his feet, else the nearest. */
  function dogDisplayId(): number | null {
    if (!body) return null;
    if (body.anchor) return body.anchor.displayId;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const d of displays) {
      const dist = distanceOutside(d.bounds, body.x, body.y);
      if (dist < bestDist) {
        best = d.id;
        bestDist = dist;
      }
    }
    return best;
  }

  function become(b: DogBehaviour): void {
    behaviour = b;
    if (b !== 'hop') hop = null;
    if (b !== 'follow') followWalk = 0;
  }

  /** What he goes back to when a hop, an effect or a Stay ends. */
  function resting(): DogBehaviour {
    return follows(mood) ? 'follow' : 'roam';
  }

  function applyMood(m: Mood): void {
    mood = m;
    if (follows(m) && (behaviour === 'roam' || behaviour === 'curl')) become('follow');
    else if (!follows(m) && behaviour === 'follow') become('roam');
  }

  function runMoodPlan(now: number): void {
    const due = moodPlan.filter((s) => s.at <= now);
    if (due.length === 0) return;
    moodPlan = moodPlan.filter((s) => s.at > now);
    for (const s of due) applyMood(s.mood);
  }

  /** The window an effect plays on, while it can: tracked, on a display, and on none that a fullscreen app hides. */
  function playable(windowId: number): TrackedWindow | null {
    const w = windows.find((x) => x.id === windowId);
    if (!w) return null;
    const on = displays.filter((d) => intersects(w.bounds, d.bounds));
    return on.length > 0 && !on.some((d) => hidden.has(d.id)) ? w : null;
  }

  function lapDistance(e: Effect): number {
    return reducedMotion ? e.lap.from : e.lap.from + LAP_SPEED * (e.elapsed - e.lap.at);
  }

  /** Puts him where the effect has him now, on the target's live rect: round its frame, or at its title bar centre. */
  function placeForEffect(e: Effect, rect: Rect): void {
    const facing = body?.facing ?? 1;
    if (e.kind === 'laps') {
      const p = lapPoint(rect, lapDistance(e));
      body = { x: p.x, y: p.y, vy: 0, facing: p.facing, anchor: null };
      side = p.side;
      return;
    }
    side = undefined;
    // Anchored, so he stays on the title bar when the dig ends. If a window above covers the centre, he digs at the nearest visible part.
    const spot = digSpot(rect);
    const seg = nearestSegment(platforms, e.windowId, spot.x);
    if (!seg) {
      body = { x: spot.x, y: spot.y, vy: 0, facing, anchor: null };
      return;
    }
    const x = clamp(spot.x, seg.x1, seg.x2);
    body = { x, y: seg.y, vy: 0, facing, anchor: { windowId: e.windowId, displayId: seg.displayId, dx: x - seg.originX } };
  }

  function startEffect(kind: Effect['kind'], windowId: number): void {
    const target = playable(windowId);
    // It also needs a visible top edge: that is where dig-in sits, and what the engine picked him a window for.
    if (!body || behaviour === 'sit-stay' || !target || !platforms.some((p) => p.windowId === windowId)) {
      endEffect();
      lostPending = true;
      return;
    }
    const limit = (kind === 'laps' ? effectMax.laps : effectMax.dig) + EFFECT_GRACE_MS;
    if (effect && effect.kind === kind && effect.windowId === windowId) {
      // The same effect again: it carries on, and its time limit starts over.
      effect.limit = effect.elapsed + limit;
    } else {
      const [seed, nextRng] = nextInt(rng, 0, 2 ** 31);
      rng = nextRng;
      // Laps start on the top edge above him, or at its nearer top corner.
      const from = clamp(body.x - target.bounds.x, 0, target.bounds.width);
      effect = { kind, windowId, seed, elapsed: 0, limit, lap: { from, at: 0 } };
    }
    become(kind);
    moodPlan = [];
    applyMood(EFFECT_MOOD[kind]);
    placeForEffect(effect, target.bounds);
  }

  /** Ends the effect where he is: after laps he falls to the nearest platform, after dig-in he stays on the title bar. */
  function endEffect(): void {
    const e = effect;
    if (!e) return;
    effect = null;
    side = undefined;
    if (behaviour === e.kind) become(resting());
    if (mood === EFFECT_MOOD[e.kind]) {
      moodPlan = [];
      applyMood('idle');
    }
  }

  function startHop(windowId: number): void {
    if (!body) return;
    const seg = nearestSegment(platforms, windowId, body.x);
    if (!seg) return;
    // Land on the nearest part of its top edge, far enough in to stand on it.
    const inset = Math.min(DOG.width / 2, (seg.x2 - seg.x1) / 2);
    const x = clamp(body.x, seg.x1 + inset, seg.x2 - inset);
    become('hop');
    hop = { windowId, from: { x: body.x, y: body.y }, landDx: x - seg.originX, elapsed: 0 };
  }

  function advanceHop(h: Hop, dt: number): void {
    if (!body) return;
    h.elapsed += Math.max(0, dt);
    const w = windows.find((x) => x.id === h.windowId);
    const seg = w ? nearestSegment(platforms, h.windowId, w.bounds.x + h.landDx) : undefined;
    if (!w || !seg) {
      // The window went away mid-hop: he drops from where he is.
      become(resting());
      body = { ...body, vy: 0, anchor: null };
      return;
    }
    const to = { x: clamp(w.bounds.x + h.landDx, seg.x1, seg.x2), y: seg.y };
    const facing = to.x === h.from.x ? body.facing : to.x > h.from.x ? 1 : -1;
    if (h.elapsed >= HOP_MS) {
      body = { x: to.x, y: to.y, vy: 0, facing, anchor: { windowId: h.windowId, displayId: seg.displayId, dx: to.x - seg.originX } };
      become(resting());
      return;
    }
    const p = hopPoint(h.from, to, h.elapsed / HOP_MS);
    body = { x: p.x, y: p.y, vy: 0, facing, anchor: null };
  }

  /** Which way to walk to follow the cursor along the platform he stands on. The only place the cursor is read. */
  function followStep(b: DogBody): Walk {
    const a = b.anchor;
    if (!a) return 0;
    const cursor = opts.cursor?.();
    if (!cursor) return 0;
    const own = platforms.filter((p) => p.windowId === a.windowId && p.displayId === a.displayId);
    const x = own[0] ? own[0].originX + a.dx : b.x;
    const seg = own.find((p) => x >= p.x1 - EPS && x <= p.x2 + EPS);
    return seg ? followDirection(x, cursor.x, seg) : 0;
  }

  function advance(): void {
    const now = clock.now();
    const dt = now - lastTick;
    lastTick = now;
    runMoodPlan(now);
    // Safety rules, every tick: the target must still be there and visible, and the effect never outlives its limit.
    if (effect) {
      effect.elapsed += Math.max(0, dt);
      const target = playable(effect.windowId);
      if (!target) {
        endEffect();
        lostPending = true;
      } else if (effect.elapsed >= effect.limit) {
        endEffect();
      } else if (body) {
        placeForEffect(effect, target.bounds);
        return;
      }
    }
    if (!body) return;
    if (behaviour === 'hop' && hop) {
      advanceHop(hop, dt);
      return;
    }
    let walk: Walk = 0;
    if (behaviour === 'roam') {
      if (roaming) {
        const [nextRoam, nextRng] = roamStep(roam, now, edgeContact(body, platforms), rng);
        roam = nextRoam;
        rng = nextRng;
      }
      walk = body.anchor ? roam.walk : 0;
    } else if (behaviour === 'follow') {
      followWalk = followStep(body);
      walk = followWalk;
    }
    // stepDog clamps him to the ends of his platform, so a follow step never overshoots it.
    body = stepDog(body, platforms, displays, dt, walk, reducedMotion ? REDUCED_WALK_SPEED : WALK_SPEED);
  }

  function poseOf(b: DogBody): DogPose {
    if (behaviour === 'laps') return 'run';
    if (behaviour === 'dig') return 'dig';
    if (behaviour === 'hop') return 'hop';
    if (!b.anchor) return 'fall';
    if (behaviour === 'curl') return 'curl';
    if (behaviour === 'follow') return followWalk !== 0 ? 'walk' : 'sit';
    if (behaviour === 'roam') return roam.walk !== 0 ? 'walk' : 'sit';
    return 'sit';
  }

  function frameFor(display: DisplayInfo): DogFrame | null {
    if (!body) return null;
    const o = display.bounds;
    const toDisplay = (r: Rect): Rect => ({ ...r, x: r.x - o.x, y: r.y - o.y });
    const e = effect;
    // The floor is the taskbar edge: the dog stands in front of windows there. On a window, or running round one, he hides behind the ones above it.
    const behind = e ? e.windowId : (body.anchor?.windowId ?? null);
    const occluders = behind !== null ? occludersFor(behind, windows) : [];
    const frame: DogFrame = {
      x: body.x - o.x,
      y: body.y - o.y,
      facing: body.facing,
      pose: poseOf(body),
      mood,
      clip: clipSprite(spriteRect(body.x, body.y, side), occluders).map(toDisplay),
      reducedMotion,
    };
    if (side) frame.side = side;
    const target = e ? windows.find((w) => w.id === e.windowId) : undefined;
    if (e && target) frame.effect = { kind: e.kind, seed: e.seed, elapsedMs: e.elapsed, rect: toDisplay(target.bounds) };
    return frame;
  }

  function emit(): void {
    const id = dogDisplayId();
    const display = displays.find((d) => d.id === id);
    const frame = display && !hidden.has(display.id) ? frameFor(display) : null;
    const target = frame && display ? display.id : null;
    if (shownOn !== null && shownOn !== target) {
      opts.sink.send(shownOn, null);
      shownOn = null;
      lastSent = null;
    }
    if (frame && target !== null) {
      // An idle dog changes nothing, so it should cost nothing: skip frames identical to the last one sent.
      const key = `${target}:${JSON.stringify(frame)}`;
      if (key === lastSent) return;
      lastSent = key;
      opts.sink.send(target, frame);
      shownOn = target;
    }
  }

  /** When to tick next: every TICK_MS while anything moves, else at the next roam pick or mood change, else never. */
  function nextWait(): number | null {
    if (lostPending) return 0;
    // An effect is checked on every tick wherever he is shown: its hard stop and the target's live rect never wait.
    // At least 1 ms, so nothing can ever spin on zero-delay timers.
    if (effect) return clamp(effect.limit - effect.elapsed, 1, TICK_MS);
    if (!body) return null;
    const id = dogDisplayId();
    if (id === null || hidden.has(id)) return null;
    const now = clock.now();
    const moving = !body.anchor || behaviour === 'hop' || behaviour === 'follow' || (behaviour === 'roam' && roam.walk !== 0);
    if (moving || now < settleUntil) return TICK_MS;
    const at = Math.min(behaviour === 'roam' ? roam.untilMs : Infinity, moodPlan[0]?.at ?? Infinity);
    return Number.isFinite(at) ? Math.max(1, at - now) : null;
  }

  function schedule(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    if (disposed) return;
    const wait = nextWait();
    if (wait !== null) timer = clock.setTimeout(tick, wait);
  }

  function tick(): void {
    timer = null;
    advance();
    emit();
    const lost = lostPending;
    lostPending = false;
    schedule();
    if (lost) opts.onEffectLost?.();
  }

  function refresh(): void {
    rebuild();
    if (displays.length === 0) {
      body = null;
    } else if (!body || (body.anchor && !displays.some((d) => d.id === body?.anchor?.displayId))) {
      body = spawnDog(platforms, displays);
    }
    settleUntil = clock.now() + SETTLE_MS;
    advance();
    emit();
    schedule();
  }

  /** Brings him up to now, applies an input, and shows the result. */
  function input(apply: () => void): void {
    if (disposed) return;
    advance();
    apply();
    emit();
    schedule();
  }

  return {
    setWorld(w, d) {
      if (disposed) return;
      windows = mode === 'edge-roaming' ? [] : w;
      displays = d;
      refresh();
    },
    setTrackerDown() {
      if (disposed) return;
      mode = 'edge-roaming';
      windows = [];
      refresh();
    },
    setReducedMotion(on) {
      // Keep his place on the lap: the distance run so far is fixed under the old setting.
      if (effect) effect.lap = { from: lapDistance(effect), at: effect.elapsed };
      reducedMotion = on;
      settleUntil = clock.now() + SETTLE_MS;
      schedule();
    },
    setRoaming(on) {
      roaming = on;
      if (!on) roam = { walk: 0, untilMs: Infinity };
      else roam = { walk: 0, untilMs: 0 };
      settleUntil = clock.now() + SETTLE_MS;
      schedule();
    },
    placeOn(windowId) {
      if (disposed || !body) return false;
      const target = platforms.filter((p) => p.windowId === windowId).sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1))[0];
      if (!target) return false;
      const x = (target.x1 + target.x2) / 2;
      body = { x, y: target.y, vy: 0, facing: body.facing, anchor: { windowId, displayId: target.displayId, dx: x - target.originX } };
      settleUntil = clock.now() + SETTLE_MS;
      emit();
      schedule();
      return true;
    },
    perform(action) {
      input(() => {
        switch (action.type) {
          case 'RUN_LAPS':
            startEffect('laps', action.windowId);
            break;
          case 'START_DIG_IN':
            startEffect('dig', action.windowId);
            break;
          case 'END_EFFECT':
            endEffect();
            break;
          // An effect runs until END_EFFECT, its limit or a Stay, and a Stay until it is lifted: a hop or a curl cuts neither short.
          case 'WALK_TO':
            if (!effect && behaviour !== 'sit-stay') startHop(action.windowId);
            break;
          case 'CURL_UP':
            if (!effect && behaviour !== 'sit-stay') become('curl');
            break;
        }
      });
    },
    setMood(name) {
      input(() => {
        const m = moodFromExpression(name);
        const hold = MOOD_HOLD_MS[m];
        moodPlan = hold === undefined ? [] : [{ at: clock.now() + hold, mood: 'idle' }];
        applyMood(m);
      });
    },
    sulkAfter() {
      input(() => {
        // Replaces any pending fallback, so a happy answer is not cut back to idle in the middle of this.
        const now = clock.now();
        moodPlan = [
          { at: now + SULK_DELAY_MS, mood: 'sulk' },
          { at: now + SULK_DELAY_MS + (MOOD_HOLD_MS.sulk ?? 0), mood: 'idle' },
        ];
      });
    },
    setStay(on) {
      input(() => {
        if (on) {
          endEffect();
          become('sit-stay');
        } else if (behaviour === 'sit-stay') {
          become(resting());
        }
      });
    },
    get behaviour() {
      return behaviour;
    },
    get mode() {
      return mode;
    },
    body() {
      return body ? { ...body, anchor: body.anchor ? { ...body.anchor } : null } : { x: 0, y: 0, vy: 0, facing: 1, anchor: null };
    },
    dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
  };
}
