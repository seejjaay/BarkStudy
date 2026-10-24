import { createRng, type RngState } from '../engine/rng';
import {
  clipSprite,
  hiddenDisplayIds,
  occludersFor,
  visibleTopEdges,
  type DisplayInfo,
  type Platform,
  type TrackedWindow,
} from '../shared/geometry';
import type { DogFrame } from '../shared/ipc';
import {
  DOG,
  edgeContact,
  REDUCED_WALK_SPEED,
  spawnDog,
  stepDog,
  WALK_SPEED,
  type DogBody,
} from '../shared/physics';
import { roamStep, type RoamState } from '../shared/roam';

export const TICK_MS = 16;
/** After the world changes, keep ticking this long so the dog follows a moving window or lands. */
export const SETTLE_MS = 250;

export interface FrameSink {
  send: (displayId: number, frame: DogFrame | null) => void;
}

export interface Clock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
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
  readonly mode: 'tracking' | 'edge-roaming';
  body: () => DogBody;
  dispose: () => void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createDogHost(opts: { seed: number; sink: FrameSink; clock?: Clock }): DogHost {
  const clock = opts.clock ?? systemClock;
  let mode: 'tracking' | 'edge-roaming' = 'tracking';
  let windows: readonly TrackedWindow[] = [];
  let displays: readonly DisplayInfo[] = [];
  let platforms: Platform[] = [];
  let hidden = new Set<number>();
  let body: DogBody | null = null;
  let lastDisplayId: number | null = null;
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

  function rebuild(): void {
    platforms = visibleTopEdges(windows, displays, DOG.height);
    hidden = hiddenDisplayIds(windows, displays);
  }

  function dogDisplayId(): number | null {
    if (body?.anchor) return body.anchor.displayId;
    if (lastDisplayId !== null && displays.some((d) => d.id === lastDisplayId)) return lastDisplayId;
    return displays[0]?.id ?? null;
  }

  function advance(): void {
    const now = clock.now();
    const dt = now - lastTick;
    lastTick = now;
    if (!body) return;
    if (roaming) {
      const [nextRoam, nextRng] = roamStep(roam, now, edgeContact(body, platforms), rng);
      roam = nextRoam;
      rng = nextRng;
    }
    const walk = body.anchor ? roam.walk : 0;
    body = stepDog(body, platforms, displays, dt, walk, reducedMotion ? REDUCED_WALK_SPEED : WALK_SPEED);
    if (body.anchor) lastDisplayId = body.anchor.displayId;
  }

  function frameFor(display: DisplayInfo): DogFrame | null {
    if (!body) return null;
    const sprite = { x: body.x - DOG.width / 2, y: body.y - DOG.height, width: DOG.width, height: DOG.height };
    // The floor is the taskbar edge: the dog stands in front of windows there. On a window it hides behind the ones above.
    const occluders = body.anchor && body.anchor.windowId !== null ? occludersFor(body.anchor.windowId, windows) : [];
    const o = display.bounds;
    return {
      x: body.x - o.x,
      y: body.y - o.y,
      facing: body.facing,
      pose: !body.anchor ? 'fall' : roam.walk !== 0 ? 'walk' : 'sit',
      clip: clipSprite(sprite, occluders).map((r) => ({ ...r, x: r.x - o.x, y: r.y - o.y })),
      reducedMotion,
    };
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

  function schedule(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    if (disposed || !body) return;
    const id = dogDisplayId();
    if (id === null || hidden.has(id)) return;
    const now = clock.now();
    const moving = !body.anchor || roam.walk !== 0;
    const wait = moving || now < settleUntil ? TICK_MS : Math.max(1, roam.untilMs - now);
    timer = clock.setTimeout(tick, wait);
  }

  function tick(): void {
    timer = null;
    advance();
    emit();
    schedule();
  }

  function refresh(): void {
    rebuild();
    if (displays.length === 0) {
      body = null;
    } else if (!body || (body.anchor && !displays.some((d) => d.id === body?.anchor?.displayId))) {
      body = spawnDog(platforms, displays);
      lastDisplayId = body.anchor?.displayId ?? null;
    }
    settleUntil = clock.now() + SETTLE_MS;
    advance();
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
      lastDisplayId = target.displayId;
      settleUntil = clock.now() + SETTLE_MS;
      emit();
      schedule();
      return true;
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
