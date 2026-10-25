import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleMonitor } from '../../src/main/idle';
import type { Activity } from '../../src/engine/types';

const tuning = { awayIdleMs: 5 * 60_000, busyIdleMs: 10_000 };

let idleSeconds: number;
let activity: Activity[];
let busy: boolean[];

function setup() {
  return createIdleMonitor({
    idleSeconds: () => idleSeconds,
    tuning,
    onActivity: (a) => activity.push(a),
    onBusy: (b) => busy.push(b),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  idleSeconds = 0;
  activity = [];
  busy = [];
});
afterEach(() => vi.useRealTimers());

describe('idle monitor', () => {
  it('polls every 5 s and stays quiet while nothing changes', () => {
    const m = setup();
    m.start();
    vi.advanceTimersByTime(60_000);
    expect(activity).toEqual([]);
    expect(busy).toEqual([true]); // typing right now, reported once at start
    m.stop();
  });

  it('typing-busy is idle under 10 s, and flips off when the user pauses', () => {
    const m = setup();
    m.start();
    expect(busy).toEqual([true]);
    idleSeconds = 9;
    vi.advanceTimersByTime(5000);
    expect(busy).toEqual([true]);
    idleSeconds = 10;
    vi.advanceTimersByTime(5000);
    expect(busy).toEqual([true, false]);
    idleSeconds = 1;
    vi.advanceTimersByTime(5000);
    expect(busy).toEqual([true, false, true]);
    m.stop();
  });

  it('idle between 10 s and 5 min is still active; 5 min is away; coming back is active', () => {
    const m = setup();
    m.start();
    idleSeconds = 299;
    vi.advanceTimersByTime(5000);
    expect(activity).toEqual([]);
    idleSeconds = 300;
    vi.advanceTimersByTime(5000);
    expect(activity).toEqual(['away']);
    idleSeconds = 0;
    vi.advanceTimersByTime(5000);
    expect(activity).toEqual(['away', 'active']);
    m.stop();
  });

  it('away is never busy', () => {
    const m = setup();
    m.start();
    idleSeconds = 600;
    vi.advanceTimersByTime(5000);
    expect(busy.at(-1)).toBe(false);
    m.stop();
  });

  it('lock reports locked at once, ignores idle time while locked, and unlock re-reads it', () => {
    const m = setup();
    m.start();
    m.setLocked(true);
    expect(activity).toEqual(['locked']);
    expect(busy.at(-1)).toBe(false);
    idleSeconds = 0;
    vi.advanceTimersByTime(30_000);
    expect(activity).toEqual(['locked']);
    m.setLocked(false);
    expect(activity).toEqual(['locked', 'active']);
    expect(busy.at(-1)).toBe(true);
    m.stop();
  });

  it('unlocking after a long absence goes straight to away, not active', () => {
    const m = setup();
    m.start();
    m.setLocked(true);
    idleSeconds = 900;
    m.setLocked(false);
    expect(activity).toEqual(['locked', 'away']);
    m.stop();
  });

  it('setLocked with an unchanged value says nothing', () => {
    const m = setup();
    m.start();
    m.setLocked(false);
    m.setLocked(true);
    m.setLocked(true);
    expect(activity).toEqual(['locked']);
    m.stop();
  });

  it('stop() ends polling, and start() twice does not double up', () => {
    const m = setup();
    m.start();
    m.start();
    m.stop();
    idleSeconds = 600;
    vi.advanceTimersByTime(60_000);
    expect(activity).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
