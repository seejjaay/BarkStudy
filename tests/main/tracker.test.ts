import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawWindow } from '../../src/shared/geometry';
import { createTracker, lazyWin32, type Win32Api, type Win32Window } from '../../src/main/tracker/tracker';

const w = (id: number, x = 0, pid = 100 + id): Win32Window => ({ id, pid, bounds: { x, y: 0, width: 400, height: 300 }, processName: `app${id}.exe` });

function fakeApi(initial: Win32Window[]) {
  const state = { windows: initial, fg: initial[0]?.id ?? 0, hookCb: null as null | (() => void), unhooked: 0, hookThrows: false, listThrows: false };
  const api: Win32Api = {
    listWindows: vi.fn(() => {
      if (state.listThrows) throw new Error('ffi died');
      return state.windows;
    }),
    foreground: () => state.fg,
    hook: (cb) => {
      if (state.hookThrows) throw new Error('no hook');
      state.hookCb = cb;
      return () => {
        state.unhooked++;
      };
    },
  };
  return { api, state };
}

function setup(windows: Win32Window[], over: { excludePid?: number | null; excludeIds?: Set<number> } = {}) {
  const f = fakeApi(windows);
  const changes: RawWindow[][] = [];
  const down: unknown[] = [];
  const tracker = createTracker(f.api, {
    excludePid: over.excludePid ?? null,
    excludeIds: () => over.excludeIds ?? new Set(),
    onChange: (list) => changes.push(list),
    onDown: (e) => down.push(e),
  });
  return { ...f, tracker, changes, down };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('tracker', () => {
  it('start emits the current windows once', () => {
    const { tracker, changes } = setup([w(1), w(2)]);
    tracker.start();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.map((x) => x.id)).toEqual([1, 2]);
    expect(tracker.running).toBe(true);
    tracker.stop();
  });

  it('start emits even when there are no windows', () => {
    const { tracker, changes } = setup([]);
    tracker.start();
    expect(changes).toEqual([[]]);
    tracker.stop();
  });

  it('a burst of 50 hook events within 16 ms emits one change', () => {
    const { tracker, changes, state, api } = setup([w(1)]);
    tracker.start();
    state.windows = [w(1, 50)];
    const before = vi.mocked(api.listWindows).mock.calls.length;
    for (let i = 0; i < 50; i++) state.hookCb?.();
    vi.advanceTimersByTime(16);
    expect(changes).toHaveLength(2);
    expect(vi.mocked(api.listWindows).mock.calls.length - before).toBe(1);
    tracker.stop();
  });

  it('own pid and excluded ids are skipped', () => {
    const { tracker, changes } = setup([w(1, 0, 4242), w(2), w(3)], { excludePid: 4242, excludeIds: new Set([3]) });
    tracker.start();
    expect(changes[0]?.map((x) => x.id)).toEqual([2]);
    tracker.stop();
  });

  it('isForeground comes from api.foreground()', () => {
    const { tracker, changes, state } = setup([w(1), w(2)]);
    state.fg = 2;
    tracker.start();
    expect(changes[0]?.map((x) => [x.id, x.isForeground])).toEqual([
      [1, false],
      [2, true],
    ]);
    tracker.stop();
  });

  it('a reconcile poll emits a change no hook reported', () => {
    const { tracker, changes, state } = setup([w(1)]);
    tracker.start();
    state.windows = [w(1), w(2)];
    vi.advanceTimersByTime(1000);
    expect(changes).toHaveLength(2);
    expect(changes[1]?.map((x) => x.id)).toEqual([1, 2]);
    tracker.stop();
  });

  it('emits nothing when the list is unchanged', () => {
    const { tracker, changes } = setup([w(1)]);
    tracker.start();
    vi.advanceTimersByTime(5000);
    expect(changes).toHaveLength(1);
    tracker.stop();
  });

  it('an api throw stops the tracker and calls onDown once', () => {
    const { tracker, state, down, api } = setup([w(1)]);
    tracker.start();
    state.listThrows = true;
    vi.advanceTimersByTime(1000);
    expect(down).toHaveLength(1);
    expect(String(down[0])).toContain('ffi died');
    expect(tracker.running).toBe(false);
    const calls = vi.mocked(api.listWindows).mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(vi.mocked(api.listWindows).mock.calls.length).toBe(calls);
    expect(down).toHaveLength(1);
  });

  it('a hook that cannot be installed reports the tracker down', () => {
    const { tracker, state, down, changes } = setup([w(1)]);
    state.hookThrows = true;
    tracker.start();
    expect(down).toHaveLength(1);
    expect(tracker.running).toBe(false);
    expect(changes).toHaveLength(0);
  });

  it('kill() behaves like a failure', () => {
    const { tracker, down, state } = setup([w(1)]);
    tracker.start();
    tracker.kill('test');
    tracker.kill('again');
    expect(down).toHaveLength(1);
    expect(tracker.running).toBe(false);
    expect(state.unhooked).toBe(1);
  });

  it('stop unhooks and clears timers without reporting down', () => {
    const { tracker, state, down } = setup([w(1)]);
    tracker.start();
    state.hookCb?.();
    tracker.stop();
    expect(state.unhooked).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(down).toHaveLength(0);
  });
});

describe('lazyWin32', () => {
  it('a binding that cannot be created reports the tracker down instead of throwing at startup', () => {
    const down: unknown[] = [];
    const tracker = createTracker(
      lazyWin32(() => {
        throw new Error('koffi missing');
      }),
      { excludePid: null, excludeIds: () => new Set(), onChange: () => {}, onDown: (e) => down.push(e) },
    );
    expect(() => tracker.start()).not.toThrow();
    expect(down).toHaveLength(1);
    expect(String(down[0])).toContain('koffi missing');
    expect(tracker.running).toBe(false);
  });

  it('builds the real binding once, on first use', () => {
    const { api } = fakeApi([w(1)]);
    const create = vi.fn(() => api);
    const lazy = lazyWin32(create);
    expect(create).not.toHaveBeenCalled();
    lazy.listWindows();
    lazy.foreground();
    lazy.hook(() => {})();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
