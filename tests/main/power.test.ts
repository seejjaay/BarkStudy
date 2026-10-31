import { describe, expect, it } from 'vitest';
import { createPowerWatch } from '../../src/main/power';

/** A fake interval: `tick()` runs every registered callback once, as if pollMs had passed. */
function fakeInterval() {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    setInterval: (fn: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (h: unknown) => void timers.delete(h as number),
    tick: () => [...timers.values()].forEach((t) => t.fn()),
    periods: () => [...timers.values()].map((t) => t.ms),
    count: () => timers.size,
  };
}

function watch(read: () => boolean, pollMs?: number) {
  const changes: boolean[] = [];
  const errors: string[] = [];
  const iv = fakeInterval();
  const power = createPowerWatch({
    read,
    onChange: (on) => changes.push(on),
    pollMs,
    setInterval: iv.setInterval,
    clearInterval: iv.clearInterval,
    log: { error: (_area, message) => void errors.push(message) },
  });
  return { power, changes, errors, ...iv };
}

describe('power watch', () => {
  it('reads at start and emits only when the value changes', () => {
    let saver = false;
    const { power, changes, tick } = watch(() => saver);
    power.start();
    expect(power.on).toBe(false);
    expect(changes).toEqual([]); // off at start is no change
    tick();
    tick();
    expect(changes).toEqual([]);
    saver = true;
    tick();
    tick();
    expect(changes).toEqual([true]);
    expect(power.on).toBe(true);
    saver = false;
    tick();
    expect(changes).toEqual([true, false]);
    power.stop();
  });

  it('emits at start when battery saver is already on', () => {
    const { power, changes } = watch(() => true);
    power.start();
    expect(changes).toEqual([true]);
    expect(power.on).toBe(true);
    power.stop();
  });

  it('polls every pollMs (30 s by default), and stop() ends the polling', () => {
    const a = watch(() => false);
    a.power.start();
    expect(a.periods()).toEqual([30_000]);
    a.power.stop();
    expect(a.count()).toBe(0);
    const b = watch(() => false, 5000);
    b.power.start();
    expect(b.periods()).toEqual([5000]);
    b.power.stop();
  });

  it('refresh() reads at once', () => {
    let saver = false;
    let reads = 0;
    const { power, changes } = watch(() => {
      reads++;
      return saver;
    });
    power.start();
    saver = true;
    const before = reads;
    power.refresh();
    expect(reads).toBe(before + 1);
    expect(changes).toEqual([true]);
    power.stop();
  });

  it('a read that throws counts as off and is logged once, not on every poll', () => {
    let fail = false;
    const { power, changes, errors, tick } = watch(() => {
      if (fail) throw new Error('kernel32 is gone');
      return true;
    });
    power.start();
    expect(changes).toEqual([true]);
    fail = true;
    tick();
    tick();
    power.refresh();
    expect(power.on).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(errors).toHaveLength(1);
    // Working again, then failing again: that is a new failure, logged once more.
    fail = false;
    tick();
    expect(changes).toEqual([true, false, true]);
    fail = true;
    tick();
    tick();
    expect(errors).toHaveLength(2);
    power.stop();
  });

  it('a throwing read at start is off, logged once, and nothing is emitted', () => {
    const { power, changes, errors, tick } = watch(() => {
      throw new Error('no koffi');
    });
    power.start();
    tick();
    expect(power.on).toBe(false);
    expect(changes).toEqual([]);
    expect(errors).toHaveLength(1);
    power.stop();
  });

  it('force(true) overrides the reading and force(null) hands back to it', () => {
    let saver = false;
    const { power, changes, tick } = watch(() => saver);
    power.start();
    power.force(true);
    expect(power.on).toBe(true);
    expect(changes).toEqual([true]);
    tick(); // the reading is still off, but the override holds
    expect(power.on).toBe(true);
    expect(changes).toEqual([true]);
    power.force(null);
    expect(power.on).toBe(false);
    expect(changes).toEqual([true, false]);
    saver = true;
    power.force(false);
    expect(power.on).toBe(false);
    power.force(null); // reads again right away
    expect(power.on).toBe(true);
    expect(changes).toEqual([true, false, true]);
    power.stop();
  });
});
