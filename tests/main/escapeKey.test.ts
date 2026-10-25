import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from '../../src/main/dogHost';
import { createEscapeKey, ESCAPE_GRACE_MS } from '../../src/main/escapeKey';

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

/** A hotkeys adapter that records what is registered. `taken` makes every register fail, like another app owning the key. */
function fakeHotkeys(taken = false) {
  const handlers = new Map<string, () => void>();
  const calls: string[] = [];
  return {
    hotkeys: {
      register: (accelerator: string, onPress: () => void) => {
        calls.push(`register ${accelerator}`);
        if (taken) return false;
        handlers.set(accelerator, onPress);
        return true;
      },
      unregister: (accelerator: string) => {
        calls.push(`unregister ${accelerator}`);
        handlers.delete(accelerator);
      },
    },
    calls,
    isRegistered: (accelerator: string) => handlers.has(accelerator),
    /** Presses the key the way Electron would: only if it is registered right now. */
    press: (accelerator: string) => handlers.get(accelerator)?.(),
  };
}

function setup(taken = false) {
  const h = fakeHotkeys(taken);
  const c = fakeClock();
  const onPress = vi.fn();
  const esc = createEscapeKey({ hotkeys: h.hotkeys, clock: c.clock, onPress });
  return { h, c, onPress, esc };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('escapeKey', () => {
  it('is not held until an effect starts', () => {
    const { h, esc } = setup();
    expect(esc.held).toBe(false);
    expect(h.isRegistered('Escape')).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('is held from effectStarted until effectEnded', () => {
    const { h, c, esc } = setup();
    esc.effectStarted(6000);
    expect(esc.held).toBe(true);
    expect(h.isRegistered('Escape')).toBe(true);
    esc.effectEnded();
    expect(esc.held).toBe(false);
    expect(h.isRegistered('Escape')).toBe(false);
    expect(c.pending()).toBe(0);
  });

  it('is released by the hard timer at maxMs + 500 with no end', () => {
    const { h, c, esc } = setup();
    esc.effectStarted(6000);
    c.advance(6000 + ESCAPE_GRACE_MS - 1);
    expect(esc.held).toBe(true);
    c.advance(1);
    expect(esc.held).toBe(false);
    expect(h.isRegistered('Escape')).toBe(false);
    expect(ESCAPE_GRACE_MS).toBe(500);
  });

  it('a press calls onPress once and releases at once', () => {
    const { h, c, onPress, esc } = setup();
    esc.effectStarted(6000);
    h.press('Escape');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(esc.held).toBe(false);
    expect(h.isRegistered('Escape')).toBe(false);
    expect(c.pending()).toBe(0);
    h.press('Escape'); // already released: Electron would not deliver it
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('two starts register once and the timer is re-armed from the second', () => {
    const { h, c, esc } = setup();
    esc.effectStarted(1000);
    c.advance(800);
    esc.effectStarted(1000);
    expect(h.calls).toEqual(['register Escape']);
    expect(c.pending()).toBe(1);
    c.advance(1000 + ESCAPE_GRACE_MS - 1); // past the first timer's deadline, before the second's
    expect(esc.held).toBe(true);
    c.advance(1);
    expect(esc.held).toBe(false);
  });

  it('a failed registration is not held and does not throw', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { c, esc } = setup(true);
    expect(() => esc.effectStarted(6000)).not.toThrow();
    expect(esc.held).toBe(false);
    expect(c.pending()).toBe(0);
    expect(() => esc.effectEnded()).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('a failed registration is logged once, not on every effect', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { esc } = setup(true);
    esc.effectStarted(6000);
    esc.effectEnded();
    esc.effectStarted(6000);
    esc.effectEnded();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('a register that throws is treated as a failed registration', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = fakeClock();
    const esc = createEscapeKey({
      hotkeys: {
        register: () => {
          throw new Error('bad accelerator');
        },
        unregister: () => {},
      },
      clock: c.clock,
      onPress: () => {},
    });
    expect(() => esc.effectStarted(6000)).not.toThrow();
    expect(esc.held).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('dispose releases', () => {
    const { h, c, esc } = setup();
    esc.effectStarted(6000);
    esc.dispose();
    expect(esc.held).toBe(false);
    expect(h.isRegistered('Escape')).toBe(false);
    expect(c.pending()).toBe(0);
  });

  it('effectEnded and dispose with nothing held touch nothing', () => {
    const { h, esc } = setup();
    esc.effectEnded();
    esc.dispose();
    expect(h.calls).toEqual([]);
  });

  it('can be held again after a press', () => {
    const { h, esc } = setup();
    esc.effectStarted(6000);
    h.press('Escape');
    esc.effectStarted(6000);
    expect(esc.held).toBe(true);
    expect(h.isRegistered('Escape')).toBe(true);
  });
});

describe('escapeKey property', () => {
  type Op =
    | { kind: 'start'; maxMs: number }
    | { kind: 'end' }
    | { kind: 'press' }
    | { kind: 'advance'; ms: number };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('start' as const), maxMs: fc.integer({ min: 1, max: 10_000 }) }),
    fc.record({ kind: fc.constant('end' as const) }),
    fc.record({ kind: fc.constant('press' as const) }),
    fc.record({ kind: fc.constant('advance' as const), ms: fc.integer({ min: 0, max: 20_000 }) }),
  );

  it('never stays held with no effect active, and never past the latest max + 500', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const h = fakeHotkeys();
        const c = fakeClock();
        let active = false;
        const esc = createEscapeKey({
          hotkeys: h.hotkeys,
          clock: c.clock,
          onPress: () => {
            active = false; // the real onPress ends the effect
          },
        });
        let deadline = 0; // when the latest start's hard timer fires
        const check = (): boolean => {
          if (esc.held && (!active || c.clock.now() > deadline)) return false;
          // The registration agrees with the flag.
          return esc.held === h.isRegistered('Escape');
        };
        for (const op of ops) {
          if (op.kind === 'start') {
            active = true;
            deadline = c.clock.now() + op.maxMs + ESCAPE_GRACE_MS;
            esc.effectStarted(op.maxMs);
          } else if (op.kind === 'end') {
            active = false;
            esc.effectEnded();
          } else if (op.kind === 'press') {
            h.press('Escape');
          } else {
            // Step through the span so the deadline is checked at each timer, not just at the end.
            let left = op.ms;
            while (left > 0) {
              const step = Math.min(left, 250);
              c.advance(step);
              left -= step;
              if (!check()) return false;
            }
          }
          if (!check()) return false;
        }
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});
