import { describe, expect, it } from 'vitest';
import { createDogHost, SETTLE_MS, TICK_MS, type Clock, type FrameSink } from '../../src/main/dogHost';
import type { DisplayInfo, TrackedWindow } from '../../src/shared/geometry';
import type { DogFrame } from '../../src/shared/ipc';
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

function setup(seed = 1) {
  const calls: [number, DogFrame | null][] = [];
  const sink: FrameSink = { send: (id, f) => calls.push([id, f]) };
  const fc = fakeClock();
  const host = createDogHost({ seed, sink, clock: fc.clock });
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
