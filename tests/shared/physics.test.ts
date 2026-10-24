import { describe, expect, it } from 'vitest';
import type { DisplayInfo, Platform } from '../../src/shared/geometry';
import {
  DOG,
  edgeContact,
  MAX_FALL_SPEED,
  MAX_STEP_MS,
  REDUCED_WALK_SPEED,
  spawnDog,
  stepDog,
  WALK_SPEED,
  type DogBody,
} from '../../src/shared/physics';

const D1: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 824 },
  scaleFactor: 1.25,
};
const displays = [D1];
const floor = (): Platform => ({ windowId: null, displayId: 1, x1: 0, x2: 1536, y: 824, originX: 0 });
const winP = (id: number, origin: number, y: number, width = 400): Platform => ({
  windowId: id,
  displayId: 1,
  x1: origin,
  x2: origin + width,
  y,
  originX: origin,
});
const onWindow = (id: number, origin: number, dx: number, y: number): DogBody => ({
  x: origin + dx,
  y,
  vy: 0,
  facing: 1,
  anchor: { windowId: id, displayId: 1, dx },
});
const falling = (x: number, y: number, vy = 0): DogBody => ({ x, y, vy, facing: 1, anchor: null });
const step = (d: DogBody, ps: Platform[], dt = 16, walk: -1 | 0 | 1 = 0, speed?: number) => stepDog(d, ps, displays, dt, walk, speed);

describe('riding', () => {
  it('an anchored dog rides a window moved 300 px over 30 steps', () => {
    let dog = onWindow(1, 100, 200, 200);
    for (let i = 1; i <= 30; i++) dog = step(dog, [winP(1, 100 + i * 10, 200), floor()]);
    expect(dog.x).toBe(600);
    expect(dog.y).toBe(200);
    expect(dog.anchor?.windowId).toBe(1);
  });

  it.each([
    [100, 0],
    [-100, 0],
    [0, 100],
    [0, -100],
  ])('a drag of (%i, %i) px per frame does not shake the dog off', (dx, dy) => {
    let dog = onWindow(1, 500, 200, 400);
    for (let i = 1; i <= 10; i++) {
      const p = winP(1, 500 + i * dx, 400 + i * dy);
      dog = step(dog, [p, floor()]);
      expect(dog.anchor?.windowId).toBe(1);
      expect(dog.y).toBe(p.y);
    }
  });

  it('a riding window moved to x=-5000 ends on the nearest floor', () => {
    let dog = onWindow(1, 100, 200, 200);
    for (let i = 0; i < 200 && (dog.anchor === null || dog.anchor.windowId !== null); i++) dog = step(dog, [floor()]);
    expect(dog.anchor?.windowId).toBeNull();
    expect(dog.x).toBeGreaterThanOrEqual(0);
    expect(dog.x).toBeLessThanOrEqual(1536);
    expect(dog.y).toBe(824);
  });

  it('a dog whose window slides off the left edge ends clamped onto the floor', () => {
    const partial: Platform = { windowId: 1, displayId: 1, x1: 0, x2: 100, y: 200, originX: -300 };
    let dog = onWindow(1, -300 + 5, 200, 200); // x = -100 once the window has moved
    dog = { ...dog, x: -95 };
    for (let i = 0; i < 400 && dog.anchor?.windowId !== null; i++) dog = step(dog, [partial, floor()]);
    expect(dog.anchor?.windowId).toBeNull();
    expect(dog.x).toBe(0);
    expect(dog.y).toBe(824);
  });
});

describe('falling', () => {
  it('when the platform vanishes the dog falls and lands on the next one below', () => {
    let dog = onWindow(1, 100, 200, 200); // x = 300
    const below = [winP(2, 200, 500), floor()];
    let steps = 0;
    do {
      dog = step(dog, below);
      steps++;
    } while (dog.anchor === null && steps < 300);
    expect(dog.anchor?.windowId).toBe(2);
    expect(dog.y).toBe(500);
    expect(dog.vy).toBe(0);
  });

  it('a fast fall does not tunnel through a platform it crosses within one step', () => {
    const dog = step(falling(300, 100, MAX_FALL_SPEED), [winP(2, 200, 150), floor()], MAX_STEP_MS);
    expect(dog.y).toBe(150);
    expect(dog.anchor?.windowId).toBe(2);
  });

  it('dt is clamped to MAX_STEP_MS', () => {
    const huge = step(falling(300, 0), [floor()], 10_000);
    const capped = step(falling(300, 0), [floor()], MAX_STEP_MS);
    expect(huge).toEqual(capped);
  });

  it('a non-finite or negative dt moves nothing', () => {
    const d = falling(300, 10, 0.1);
    expect(step(d, [floor()], Number.NaN)).toEqual(step(d, [floor()], 0));
    expect(step(d, [floor()], -50)).toEqual(step(d, [floor()], 0));
  });

  it('a dog below every platform is put back on the nearest floor', () => {
    const dog = step(falling(300, 5000), [floor()]);
    expect(dog.y).toBe(824);
    expect(dog.anchor?.windowId).toBeNull();
  });
});

describe('walking', () => {
  it('walking stops at the segment end and edgeContact reports it', () => {
    const p = winP(1, 100, 200);
    let dog = onWindow(1, 100, 200, 200);
    for (let i = 0; i < 100; i++) dog = step(dog, [p, floor()], 50, 1);
    expect(dog.x).toBe(500);
    expect(edgeContact(dog, [p, floor()])).toBe(1);
    for (let i = 0; i < 200; i++) dog = step(dog, [p, floor()], 50, -1);
    expect(dog.x).toBe(100);
    expect(edgeContact(dog, [p, floor()])).toBe(-1);
    expect(dog.facing).toBe(-1);
  });

  it('edgeContact is 0 mid-segment and when falling', () => {
    expect(edgeContact(onWindow(1, 100, 200, 200), [winP(1, 100, 200)])).toBe(0);
    expect(edgeContact(falling(300, 10), [floor()])).toBe(0);
  });

  it('walk speed: 1000 ms of walk moves 60 px, reduced motion moves 30 px', () => {
    const start = onWindow(1, 0, 500, 824);
    const p: Platform = { windowId: 1, displayId: 1, x1: 0, x2: 1536, y: 824, originX: 0 };
    let a = start;
    let b = start;
    for (let i = 0; i < 20; i++) {
      a = step(a, [p], 50, 1, WALK_SPEED);
      b = step(b, [p], 50, 1, REDUCED_WALK_SPEED);
    }
    expect(a.x).toBeCloseTo(560, 6);
    expect(b.x).toBeCloseTo(530, 6);
  });
});

describe('spawn and purity', () => {
  it('spawnDog stands on the first display floor centre', () => {
    const dog = spawnDog([floor()], displays);
    expect(dog).toMatchObject({ x: 768, y: 824, vy: 0, anchor: { windowId: null, displayId: 1 } });
  });

  it('the dog sprite size is the plan constant', () => {
    expect(DOG).toEqual({ width: 64, height: 48 });
  });

  it('stepDog does not mutate its input', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object') Object.values(o).forEach(deepFreeze);
      return Object.freeze(o);
    };
    const dog = deepFreeze(onWindow(1, 100, 200, 200));
    const ps = deepFreeze([winP(1, 110, 200), floor()]);
    expect(() => step(dog, ps, 16, 1)).not.toThrow();
    expect(() => step(deepFreeze(falling(300, 10)), ps)).not.toThrow();
  });
});
