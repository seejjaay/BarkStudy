import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../src/engine/tuning';
import { createDogHost, SETTLE_MS, TICK_MS, type Clock, type FrameSink } from '../../src/main/dogHost';
import { FOLLOW_DEADZONE, HOP_MS, LAP_SPEED, type Point } from '../../src/shared/behaviour';
import type { DisplayInfo, Rect, TrackedWindow } from '../../src/shared/geometry';
import type { DogFrame } from '../../src/shared/ipc';
import { MOOD_HOLD_MS } from '../../src/shared/mood';
import { DOG, REDUCED_WALK_SPEED, WALK_SPEED } from '../../src/shared/physics';

const D1: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 824 },
  scaleFactor: 1.25,
};
const D2: DisplayInfo = {
  id: 2,
  bounds: { x: 1536, y: 0, width: 1280, height: 720 },
  workArea: { x: 1536, y: 0, width: 1280, height: 680 },
  scaleFactor: 1,
};

const win = (id: number, x: number, y = 300, over: Partial<TrackedWindow> = {}): TrackedWindow => ({
  id,
  bounds: { x, y, width: 400, height: 300 },
  z: id - 1,
  processName: 'a.exe',
  isForeground: false,
  fullscreen: false,
  ...over,
});

function fakeClock() {
  let now = 1_000_000;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const t = { at: now + Math.max(0, ms), fn, id: next++ };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  return {
    clock,
    pending: () => timers.length,
    /** The wall clock jumps (sleep, NTP, the user changing the time). Pending timers keep their real delay. */
    jump: (ms: number) => {
      now += ms;
      for (const t of timers) t.at += ms;
    },
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > target) break;
        timers.shift();
        now = Math.max(now, t.at);
        t.fn();
      }
      now = target;
    },
  };
}

type HostExtras = Omit<Parameters<typeof createDogHost>[0], 'seed' | 'sink' | 'clock'>;

function setup(seed = 1, extras: HostExtras = {}) {
  const calls: [number, DogFrame | null][] = [];
  const sink: FrameSink = { send: (id, f) => calls.push([id, f]) };
  const fc = fakeClock();
  const host = createDogHost({ seed, sink, clock: fc.clock, ...extras });
  const last = (displayId: number) => [...calls].reverse().find(([id]) => id === displayId)?.[1];
  return { host, calls, last, ...fc };
}

describe('dog host', () => {
  it('spawns on a floor and sends a frame to that display only', () => {
    const { host, calls, last } = setup();
    host.setWorld([], [D1, D2]);
    expect(last(1)).toMatchObject({ x: 768, y: 824 });
    expect(calls.filter(([id]) => id === 2)).toEqual([]);
    expect(host.mode).toBe('tracking');
    host.dispose();
  });

  it("a fresh dog's frame has mood idle", () => {
    const { host, last } = setup();
    host.setWorld([], [D1]);
    expect(last(1)?.mood).toBe('idle');
    host.dispose();
  });

  it('does not resend an identical frame', () => {
    const { host, calls } = setup();
    host.setWorld([], [D1]);
    const sent = calls.length;
    host.setWorld([], [D1]);
    host.setWorld([], [D1]);
    expect(calls.length).toBe(sent);
    host.dispose();
  });

  it('frame coordinates are relative to the display origin', () => {
    const { host, last } = setup();
    host.setWorld([], [D2, D1]);
    expect(last(2)).toMatchObject({ x: 640, y: 680 });
    host.dispose();
  });

  it('rides a window moved 300 px in 30 setWorld updates', () => {
    const { host } = setup();
    host.setWorld([win(1, 100)], [D1]);
    expect(host.placeOn(1)).toBe(true);
    const startX = host.body().x;
    for (let i = 1; i <= 30; i++) host.setWorld([win(1, 100 + i * 10)], [D1]);
    expect(host.body().x).toBeCloseTo(startX + 300, 6);
    expect(host.body().anchor?.windowId).toBe(1);
    expect(host.body().y).toBe(300);
    host.dispose();
  });

  it('falls to the floor when its window disappears', () => {
    const { host, advance } = setup();
    host.setWorld([win(1, 100)], [D1]);
    host.placeOn(1);
    host.setWorld([], [D1]);
    advance(3000);
    expect(host.body().anchor?.windowId).toBeNull();
    expect(host.body().y).toBe(824);
    host.dispose();
  });

  it('tracker down switches to edge-roaming: windows ignored, dog on the floor', () => {
    const { host, advance } = setup();
    host.setWorld([win(1, 100)], [D1]);
    host.placeOn(1);
    host.setTrackerDown();
    expect(host.mode).toBe('edge-roaming');
    host.setWorld([win(1, 100)], [D1]);
    advance(3000);
    expect(host.body().anchor?.windowId).toBeNull();
    expect(host.body().y).toBe(824);
    expect(host.placeOn(1)).toBe(false);
    host.dispose();
  });

  it('display removed respawns the dog on a remaining display', () => {
    const { host, calls, last } = setup();
    host.setWorld([], [D2, D1]);
    expect(host.body().anchor?.displayId).toBe(2);
    host.setWorld([], [D1]);
    expect(calls).toContainEqual([2, null]);
    expect(host.body().anchor?.displayId).toBe(1);
    expect(last(1)).toMatchObject({ y: 824 });
    host.dispose();
  });

  it('fullscreen foreground on the dog display sends null', () => {
    const { host, last } = setup();
    host.setWorld([], [D1]);
    expect(last(1)).not.toBeNull();
    host.setWorld([win(1, 0, 0, { bounds: D1.bounds, fullscreen: true, isForeground: true })], [D1]);
    expect(last(1)).toBeNull();
    host.setWorld([], [D1]);
    expect(last(1)).not.toBeNull();
    host.dispose();
  });

  it('the floor dog is not clipped by windows; a window dog is clipped by windows above it', () => {
    const { host, last, advance } = setup();
    host.setWorld([win(1, 100, 300, { z: 1 }), win(2, 140, 200, { z: 0 })], [D1]);
    host.placeOn(1);
    host.setWorld([win(1, 100, 300, { z: 1 }), win(2, 140, 200, { z: 0 })], [D1]);
    const frame = last(1);
    // Window 1's visible edge is x 100..140 (window 2 above covers the rest), so the centred sprite overhangs window 2 and is cut.
    expect(frame?.clip.length).toBeGreaterThan(0);
    const visible = frame?.clip.reduce((n, r) => n + r.width * r.height, 0) ?? 0;
    expect(visible).toBeLessThan(DOG.width * DOG.height);
    host.setWorld([win(2, 140, 200, { z: 0 })], [D1]); // window 1 gone: the dog falls to the floor, behind nothing
    advance(3000);
    expect(host.body().anchor?.windowId).toBeNull();
    const floorFrame = last(1);
    expect(floorFrame?.clip).toEqual([{ x: host.body().x - DOG.width / 2, y: 824 - DOG.height, width: DOG.width, height: DOG.height }]);
    host.dispose();
  });

  it('goes idle: no frames and at most one wake-up timer while sitting in a still world', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { host, calls, advance, last, pending } = setup(seed);
      host.setWorld([], [D1]);
      advance(SETTLE_MS + 100);
      if (last(1)?.pose !== 'sit') {
        host.dispose();
        continue;
      }
      const before = calls.length;
      advance(2500); // a fresh sit lasts at least 3000 ms
      expect(calls.length - before).toBe(0);
      expect(pending()).toBeLessThanOrEqual(1);
      host.dispose();
      return;
    }
    throw new Error('no seed produced a sitting dog');
  });

  it('keeps ticking while it walks', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { host, calls, advance, last } = setup(seed);
      host.setWorld([], [D1]);
      advance(SETTLE_MS + 100);
      if (last(1)?.pose !== 'walk') {
        host.dispose();
        continue;
      }
      const before = calls.length;
      advance(1000);
      expect(calls.length - before).toBeGreaterThanOrEqual(Math.floor(1000 / TICK_MS) - 3);
      host.dispose();
      return;
    }
    throw new Error('no seed produced a walking dog');
  });

  it('reduced motion walks at REDUCED_WALK_SPEED', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const normal = setup(seed);
      const reduced = setup(seed);
      reduced.host.setReducedMotion(true);
      for (const t of [normal, reduced]) {
        t.host.setWorld([], [D1]);
        t.advance(TICK_MS * 2); // first roam pick happens here
      }
      const n0 = normal.host.body().x;
      const r0 = reduced.host.body().x;
      normal.advance(1000);
      reduced.advance(1000);
      const dn = normal.host.body().x - n0;
      const dr = reduced.host.body().x - r0;
      if (Math.abs(dn) > 1) {
        expect(Math.abs(dn)).toBeCloseTo(WALK_SPEED * 1000, 0);
        expect(Math.abs(dr)).toBeCloseTo(REDUCED_WALK_SPEED * 1000, 0);
        expect(reduced.last(1)?.reducedMotion).toBe(true);
        normal.host.dispose();
        reduced.host.dispose();
        return;
      }
      normal.host.dispose();
      reduced.host.dispose();
    }
    throw new Error('no seed produced a walking dog');
  });

  it('with roaming off the dog never walks on its own', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { host, advance } = setup(seed);
      host.setRoaming(false);
      host.setWorld([], [D1]);
      advance(5000);
      expect(host.body().x).toBe(768);
      host.dispose();
    }
  });

  it('placeOn anchors to that window and returns false for an unknown id', () => {
    const { host } = setup();
    host.setWorld([win(1, 100)], [D1]);
    expect(host.placeOn(99)).toBe(false);
    expect(host.placeOn(1)).toBe(true);
    expect(host.body().anchor?.windowId).toBe(1);
    expect(host.body().y).toBe(300);
    host.dispose();
  });

  it('dispose stops all timers', () => {
    const { host, pending } = setup();
    host.setWorld([], [D1]);
    host.dispose();
    expect(pending()).toBe(0);
  });

  it('with no displays there is nothing to show and nothing crashes', () => {
    const { host, calls } = setup();
    host.setWorld([], []);
    expect(calls).toEqual([]);
    host.dispose();
  });
});

/** How far `p` is from the outline of `r` (0 on it). */
function distToPerimeter(r: Rect, p: Point): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(p.x - r.x, r.x + r.width - p.x, p.y - r.y, r.y + r.height - p.y);
}

describe('dog host behaviours', () => {
  const T = win(7, 300); // x 300..700, y 300..600; he spawns on the floor at x 768, right of it
  const fullscreenOn = (d: DisplayInfo): TrackedWindow => win(8, d.bounds.x, d.bounds.y, { bounds: d.bounds, z: 0, fullscreen: true, isForeground: true });
  const lapsStop = DEFAULT_TUNING.lapsMaxMs + 500;
  const digStop = DEFAULT_TUNING.digInMaxMs + 500;

  function behaviourHost(extras: HostExtras = {}) {
    let lost = 0;
    const t = setup(1, {
      onEffectLost: () => {
        lost++;
      },
      ...extras,
    });
    return { ...t, lost: () => lost, framesWithEffect: () => t.calls.filter(([, f]) => f?.effect !== undefined).length };
  }

  it('RUN_LAPS moves him around the window frame', () => {
    const { host, last, advance } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    expect(host.behaviour).toBe('laps');
    const start = host.body();
    advance(500);
    const f = last(1);
    expect(f).toMatchObject({ pose: 'run', mood: 'zoomies', effect: { kind: 'laps', rect: T.bounds } });
    expect(f?.side).toBeDefined();
    expect(f?.effect?.elapsedMs).toBeGreaterThan(450);
    const b = host.body();
    expect(distToPerimeter(T.bounds, b)).toBeLessThanOrEqual(1);
    expect(Math.hypot(b.x - start.x, b.y - start.y)).toBeGreaterThan(LAP_SPEED * 400);
    host.dispose();
  });

  it('END_EFFECT ends laps and he falls back onto a platform', () => {
    const { host, last, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(1500); // along the bottom edge by now
    expect(host.body().anchor).toBeNull();
    host.perform({ type: 'END_EFFECT' });
    expect(host.behaviour).toBe('roam');
    expect(last(1)?.effect).toBeUndefined();
    expect(last(1)?.side).toBeUndefined();
    advance(2000);
    expect(host.body().anchor).not.toBeNull();
    expect(last(1)?.mood).toBe('idle');
    expect(lost()).toBe(0);
    host.dispose();
  });

  it('laps stop by themselves at lapsMaxMs + 500 with no END_EFFECT', () => {
    const { host, last, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(lapsStop - 20);
    expect(host.behaviour).toBe('laps');
    advance(40);
    expect(host.behaviour).toBe('roam');
    expect(last(1)?.effect).toBeUndefined();
    expect(lost()).toBe(0);
    host.dispose();
  });

  it('dig-in stops by itself at digInMaxMs + 500 with no END_EFFECT', () => {
    const { host, last, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'START_DIG_IN', windowId: 7 });
    advance(digStop - 20);
    expect(host.behaviour).toBe('dig');
    advance(40);
    expect(host.behaviour).toBe('roam');
    expect(last(1)?.effect).toBeUndefined();
    expect(lost()).toBe(0);
    host.dispose();
  });

  it('effectMaxMs overrides the default limits', () => {
    const { host, advance } = behaviourHost({ effectMaxMs: { laps: 1000, dig: 2000 } });
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(1480);
    expect(host.behaviour).toBe('laps');
    advance(40);
    expect(host.behaviour).toBe('roam');
    host.perform({ type: 'START_DIG_IN', windowId: 7 });
    advance(2480);
    expect(host.behaviour).toBe('dig');
    advance(40);
    expect(host.behaviour).toBe('roam');
    host.dispose();
  });

  it('a wall-clock jump forward ends the effect on the next tick; a jump back does not stretch it', () => {
    const fwd = behaviourHost();
    fwd.host.setWorld([T], [D1]);
    fwd.host.perform({ type: 'RUN_LAPS', windowId: 7 });
    fwd.advance(100);
    fwd.jump(60_000);
    fwd.advance(TICK_MS);
    expect(fwd.host.behaviour).toBe('roam');
    fwd.host.dispose();

    const back = behaviourHost();
    back.host.setWorld([T], [D1]);
    back.host.perform({ type: 'RUN_LAPS', windowId: 7 });
    back.advance(100);
    back.jump(-60_000);
    back.advance(lapsStop - 100 - 2 * TICK_MS);
    expect(back.host.behaviour).toBe('laps');
    back.advance(3 * TICK_MS); // stops on real time, one tick late at most
    expect(back.host.behaviour).toBe('roam');
    back.host.dispose();
  });

  it('START_DIG_IN puts him on the title bar centre digging, and he stays there after it ends', () => {
    const { host, last, advance } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'START_DIG_IN', windowId: 7 });
    expect(host.behaviour).toBe('dig');
    advance(1000);
    expect(last(1)).toMatchObject({ pose: 'dig', mood: 'dig', x: 500, y: 300, effect: { kind: 'dig', rect: T.bounds } });
    expect(host.body().anchor?.windowId).toBe(7);
    host.perform({ type: 'END_EFFECT' });
    expect(host.behaviour).toBe('roam');
    advance(3000);
    expect(host.body().anchor?.windowId).toBe(7);
    expect(host.body().y).toBe(300);
    host.dispose();
  });

  it.each([
    ['the window disappears from the world', [] as TrackedWindow[]],
    ['its display becomes hidden by a fullscreen window', [T, fullscreenOn(D1)]],
  ])('the target vanishing stops the effect and calls onEffectLost exactly once: %s', (_, world) => {
    for (const type of ['RUN_LAPS', 'START_DIG_IN'] as const) {
      const { host, advance, lost } = behaviourHost();
      host.setWorld([T], [D1]);
      host.perform({ type, windowId: 7 });
      advance(300);
      host.setWorld(world, [D1]);
      expect(host.behaviour).toBe('roam');
      advance(TICK_MS);
      expect(lost()).toBe(1);
      host.setWorld(world, [D1]);
      advance(3000);
      host.perform({ type: 'END_EFFECT' });
      advance(100);
      expect(lost()).toBe(1);
      host.dispose();
    }
  });

  it('a loss report still pending does not cut short the next effect the engine starts', () => {
    const U = win(9, 900);
    for (const next of ['RUN_LAPS', 'START_DIG_IN'] as const) {
      const { host, advance, lost } = behaviourHost();
      host.setWorld([T, U], [D1]);
      host.perform({ type: 'RUN_LAPS', windowId: 7 });
      advance(300);
      host.setWorld([U], [D1]); // E1's window is gone; the report waits for the next tick
      host.perform({ type: next, windowId: 9 }); // the engine, meanwhile, starts E2
      advance(TICK_MS);
      expect(lost()).toBe(0);
      expect(host.behaviour).toBe(next === 'RUN_LAPS' ? 'laps' : 'dig');
      host.dispose();
    }
  });

  it('the engine ending the effect itself withdraws a pending loss report', () => {
    const { host, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(300);
    host.setWorld([], [D1]);
    host.perform({ type: 'END_EFFECT' });
    advance(TICK_MS);
    expect(lost()).toBe(0);
    host.dispose();
  });

  it('the tracker going down mid-effect counts as the target lost', () => {
    const { host, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(300);
    host.setTrackerDown();
    advance(TICK_MS);
    expect(host.behaviour).toBe('roam');
    expect(lost()).toBe(1);
    host.dispose();
  });

  it('an effect on a window that does not exist never starts and reports lost', () => {
    const covered = win(9, 200, 250, { bounds: { x: 200, y: 250, width: 600, height: 500 }, z: 0 }); // hides T's whole top edge
    const cases: [TrackedWindow[], number][] = [
      [[T], 99],
      [[T, fullscreenOn(D1)], 7],
      [[T, covered], 7],
    ];
    for (const [world, windowId] of cases) {
      for (const type of ['RUN_LAPS', 'START_DIG_IN'] as const) {
        const { host, advance, lost, framesWithEffect } = behaviourHost();
        host.setWorld(world, [D1]);
        host.perform({ type, windowId });
        expect(host.behaviour).toBe('roam');
        expect(lost()).toBe(0); // reported from the tick, never from inside perform()
        advance(TICK_MS);
        expect(lost()).toBe(1);
        advance(3000);
        expect(lost()).toBe(1);
        expect(framesWithEffect()).toBe(0);
        host.dispose();
      }
    }
  });

  it('Review Focus #2: dragging the target during laps moves the path with it', () => {
    const { host, last, advance } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(300); // down the right side
    const moved = win(7, 500);
    host.setWorld([moved], [D1]);
    advance(TICK_MS);
    const b = host.body();
    expect(distToPerimeter(moved.bounds, b)).toBeLessThanOrEqual(1);
    expect(distToPerimeter(T.bounds, b)).toBeGreaterThan(100);
    expect(last(1)?.effect?.rect).toEqual(moved.bounds);
    host.dispose();
  });

  // Regression (M4 capture at 125%): round a maximised window his feet ran along the screen edges, so on the top, the
  // right and the left his body was drawn off-screen. Sides with no room outside are run just inside the frame instead.
  it('laps round a maximised window keep him on screen, and the prints follow the same loop', () => {
    const { host, last, advance } = behaviourHost();
    const maxed = win(7, 0, 0, { bounds: D1.workArea, isForeground: true });
    host.setWorld([maxed], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    expect(host.behaviour).toBe('laps');
    const loop = { x: DOG.height, y: DOG.height, width: D1.workArea.width - 2 * DOG.height, height: D1.workArea.height - 2 * DOG.height };
    const wa = D1.workArea;
    const sides = new Set<string>();
    for (let t = 0; t < DEFAULT_TUNING.lapsMaxMs; t += 100) {
      advance(100);
      const f = last(1);
      if (!f?.effect) break;
      expect(f.effect.rect).toEqual(loop);
      const b = host.body();
      expect(distToPerimeter(loop, b)).toBeLessThanOrEqual(1);
      // His sprite (DOG.height out from his feet, DOG.width along the edge) stays inside the work area.
      expect(b.x - DOG.height).toBeGreaterThanOrEqual(wa.x - 1);
      expect(b.x + DOG.height).toBeLessThanOrEqual(wa.x + wa.width + 1);
      expect(b.y - DOG.height).toBeGreaterThanOrEqual(wa.y - 1);
      expect(b.y + DOG.height).toBeLessThanOrEqual(wa.y + wa.height + 1);
      if (f.side) sides.add(f.side);
    }
    expect(sides.size).toBeGreaterThanOrEqual(2); // it was checked on more than one side
    host.dispose();
  });

  it('Review Focus #2: dragging the target during dig-in keeps him on its title bar centre', () => {
    const { host, last, advance } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'START_DIG_IN', windowId: 7 });
    advance(300);
    const moved = win(7, 500, 200);
    host.setWorld([moved], [D1]);
    advance(TICK_MS);
    expect(host.body()).toMatchObject({ x: 700, y: 200 });
    expect(last(1)).toMatchObject({ x: 700, y: 200, effect: { rect: moved.bounds } });
    host.dispose();
  });

  it('Review Focus #3: laps that cross onto another display hand the frame over', () => {
    const { host, calls, last, advance } = behaviourHost();
    const wide = win(7, 1336, 200); // x 1336..1736: spans D1 and D2
    host.setWorld([wide], [D1, D2]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    expect(last(1)?.effect?.kind).toBe('laps'); // he starts at its top-left corner, on D1
    const before = calls.length;
    advance(600); // 270 px along the top edge: past x 1536, onto D2
    expect(calls.slice(before)).toContainEqual([1, null]);
    const onB = last(2);
    expect(onB?.effect?.kind).toBe('laps');
    expect(onB?.x).toBeCloseTo(host.body().x - D2.bounds.x, 6);
    expect(onB?.effect?.rect).toEqual({ ...wide.bounds, x: wide.bounds.x - D2.bounds.x });
    expect(last(1)).toBeNull();
    advance(1600); // round the right side and back along the bottom edge, onto D1 again
    expect(last(1)?.effect?.kind).toBe('laps');
    expect(last(2)).toBeNull();
    host.dispose();
  });

  it("WALK_TO hops to that window's top edge and lands anchored on it", () => {
    const { host, last, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'WALK_TO', windowId: 99 });
    expect(host.behaviour).toBe('roam'); // no such window: nothing to hop to
    host.perform({ type: 'WALK_TO', windowId: 7 });
    expect(host.behaviour).toBe('hop');
    advance(HOP_MS / 2);
    expect(last(1)?.pose).toBe('hop');
    expect(host.body().anchor).toBeNull();
    expect(host.body().y).toBeLessThan(824);
    advance(HOP_MS);
    expect(host.behaviour).toBe('roam');
    expect(host.body().anchor?.windowId).toBe(7);
    expect(host.body().y).toBe(300);
    expect(lost()).toBe(0);
    host.dispose();
  });

  it('follow walks toward the cursor along his platform and stops in the dead zone', () => {
    let cursor: Point | null = { x: 1200, y: 100 };
    const { host, last, advance } = behaviourHost({ cursor: () => cursor });
    host.setWorld([], [D1]); // he stands on the floor at x 768
    host.setMood('pleading');
    expect(host.behaviour).toBe('follow');
    advance(1000);
    expect(host.body().x).toBeGreaterThan(768 + WALK_SPEED * 900);
    expect(host.body().x).toBeLessThanOrEqual(768 + WALK_SPEED * 1000);
    expect(last(1)?.pose).toBe('walk');
    advance(10_000);
    expect(Math.abs(1200 - host.body().x)).toBeLessThanOrEqual(FOLLOW_DEADZONE);
    expect(last(1)?.pose).toBe('sit');
    cursor = { x: 5000, y: 100 }; // past the right end of the floor
    advance(20_000);
    expect(host.body().x).toBe(D1.workArea.width);
    cursor = { x: -5000, y: 100 };
    advance(40_000);
    expect(host.body().x).toBe(0);
    cursor = null;
    advance(1000);
    expect(host.body().x).toBe(0);
    host.setMood('idle');
    expect(host.behaviour).toBe('roam');
    host.setMood('follow-cursor');
    expect(host.behaviour).toBe('follow');
    host.dispose();
  });

  it('cursor() is never called when not following', () => {
    let reads = 0;
    const { host, advance } = behaviourHost({
      cursor: () => {
        reads++;
        return { x: 0, y: 0 };
      },
    });
    host.setWorld([T], [D1]);
    advance(5000);
    host.setMood('happy');
    advance(3000);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(1000);
    host.perform({ type: 'END_EFFECT' });
    advance(2000);
    host.perform({ type: 'CURL_UP' });
    advance(1000);
    expect(reads).toBe(0);
    host.setMood('pleading');
    advance(100);
    expect(reads).toBeGreaterThan(0);
    host.setMood('calm');
    const seen = reads;
    advance(3000);
    expect(reads).toBe(seen);
    host.dispose();
  });

  it('CURL_UP gives pose curl and he does not move', () => {
    const { host, calls, last, advance, pending } = behaviourHost();
    host.setWorld([], [D1]);
    host.perform({ type: 'CURL_UP' });
    expect(host.behaviour).toBe('curl');
    const x = host.body().x;
    advance(SETTLE_MS + 100);
    const sent = calls.length;
    advance(30_000);
    expect(host.body().x).toBe(x);
    expect(last(1)?.pose).toBe('curl');
    expect(calls.length).toBe(sent); // a curled-up dog costs nothing
    expect(pending()).toBeLessThanOrEqual(1);
    host.dispose();
  });

  it('wake() gets him up from a curl to roam, and changes nothing when he is not curled up', () => {
    const { host, last, advance } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'CURL_UP' });
    advance(1000);
    host.wake();
    expect(host.behaviour).toBe('roam');
    expect(last(1)?.pose).not.toBe('curl');
    host.setStay(true);
    host.wake(); // a Stay is lifted only by setStay(false)
    expect(host.behaviour).toBe('sit-stay');
    host.setStay(false);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    host.wake(); // nor does it cut an effect short
    expect(host.behaviour).toBe('laps');
    host.dispose();
  });

  it('an effect he cannot start leaves no zoomies or dig mood behind, whichever comes first', () => {
    const { host, last, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    // The engine routes its action, then its expression: the mood lands after the refusal.
    host.perform({ type: 'RUN_LAPS', windowId: 99 });
    host.setMood('zoomies');
    advance(TICK_MS);
    expect(lost()).toBe(1);
    host.perform({ type: 'END_EFFECT' }); // the engine's answer to the loss report
    expect(last(1)?.mood).toBe('idle');
    host.setMood('dig');
    host.perform({ type: 'START_DIG_IN', windowId: 99 });
    expect(last(1)?.mood).toBe('idle');
    host.setMood('whine'); // a mood that is not an effect's is left alone
    host.perform({ type: 'END_EFFECT' });
    expect(last(1)?.mood).toBe('whine');
    host.dispose();
  });

  it('lifting a Stay drops the sit mood that came with it', () => {
    const { host, last } = behaviourHost();
    host.setWorld([T], [D1]);
    host.setStay(true);
    host.setMood('sit'); // the engine's sit-stay expression
    host.setStay(false);
    expect(host.behaviour).toBe('roam');
    expect(last(1)?.mood).toBe('idle');
    host.dispose();
  });

  it('setStay(true) sits him until setStay(false)', () => {
    const { host, last, advance, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(300);
    host.setStay(true); // a Stay ends the effect quietly; the engine sends its own END_EFFECT
    expect(host.behaviour).toBe('sit-stay');
    expect(last(1)?.effect).toBeUndefined();
    advance(2000);
    expect(host.body().anchor).not.toBeNull();
    expect(last(1)?.pose).toBe('sit');
    const x = host.body().x;
    host.perform({ type: 'WALK_TO', windowId: 7 });
    host.perform({ type: 'CURL_UP' });
    host.perform({ type: 'RUN_LAPS', windowId: 7 }); // refused, so the engine is told
    advance(20_000);
    expect(host.behaviour).toBe('sit-stay');
    expect(host.body().x).toBe(x);
    expect(last(1)?.pose).toBe('sit');
    expect(lost()).toBe(1);
    host.setStay(false);
    expect(host.behaviour).toBe('roam');
    host.dispose();
  });

  it("setMood('happy') falls back to idle after 2 s", () => {
    const { host, last, advance } = behaviourHost();
    host.setWorld([], [D1]);
    host.setMood('happy');
    expect(last(1)?.mood).toBe('happy');
    advance(1900);
    expect(last(1)?.mood).toBe('happy');
    advance(200);
    expect(last(1)?.mood).toBe('idle');
    host.setMood('whine'); // not a short mood: held until the engine says otherwise
    advance(10_000);
    expect(last(1)?.mood).toBe('whine');
    host.setMood('no-such-mood');
    expect(last(1)?.mood).toBe('idle');
    host.dispose();
  });

  it('sulkAfter() keeps the current mood ~1.5 s, then sulk for 4 s, then idle', () => {
    const { host, last, advance } = behaviourHost();
    host.setWorld([], [D1]);
    host.setMood('happy');
    host.sulkAfter();
    advance(1400);
    expect(last(1)?.mood).toBe('happy');
    advance(200); // 1.6 s
    expect(last(1)?.mood).toBe('sulk');
    advance(1000); // 2.6 s: happy's own 2 s fallback was cancelled
    expect(last(1)?.mood).toBe('sulk');
    advance(1500 + (MOOD_HOLD_MS.sulk ?? 0) - 2600 - 100); // just before the sulk ends
    expect(last(1)?.mood).toBe('sulk');
    advance(200);
    expect(last(1)?.mood).toBe('idle');
    host.dispose();
  });

  it('reduced motion: laps do not move him and the mood is zoomies', () => {
    const { host, last, advance } = behaviourHost();
    host.setReducedMotion(true);
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    const start = host.body();
    advance(2000);
    expect(host.body()).toMatchObject({ x: start.x, y: start.y });
    expect(distToPerimeter(T.bounds, host.body())).toBeLessThanOrEqual(1);
    expect(last(1)).toMatchObject({ mood: 'zoomies', reducedMotion: true, effect: { kind: 'laps' } });
    advance(lapsStop);
    expect(host.behaviour).toBe('roam');
    host.dispose();
  });

  it('a second RUN_LAPS while lapping restarts the timer without stacking effects', () => {
    const { host, last, advance, pending, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    advance(4000);
    const before = host.body();
    host.perform({ type: 'RUN_LAPS', windowId: 7 });
    expect(pending()).toBe(1);
    expect(last(1)?.effect?.elapsedMs).toBeGreaterThanOrEqual(4000 - TICK_MS); // the same effect, carrying on
    expect(Math.hypot(host.body().x - before.x, host.body().y - before.y)).toBeLessThanOrEqual(LAP_SPEED * TICK_MS + 1); // no jump back
    advance(lapsStop - 4000 + 100); // past where the first run would have stopped
    expect(host.behaviour).toBe('laps');
    expect(pending()).toBe(1);
    advance(4000 - 100 - 20); // just before the second run's stop
    expect(host.behaviour).toBe('laps');
    advance(40);
    expect(host.behaviour).toBe('roam');
    expect(lost()).toBe(0);
    host.dispose();
  });

  it('dispose stops every timer, a pending lost report included', () => {
    const { host, advance, pending, lost } = behaviourHost();
    host.setWorld([T], [D1]);
    host.perform({ type: 'RUN_LAPS', windowId: 99 });
    host.dispose();
    expect(pending()).toBe(0);
    advance(lapsStop);
    expect(lost()).toBe(0);
  });
});
