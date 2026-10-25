import type { Activity } from '../engine/types';

export interface IdleOptions {
  /** Seconds since the last keyboard or mouse input (`powerMonitor.getSystemIdleTime`). */
  idleSeconds: () => number;
  tuning: { awayIdleMs: number; busyIdleMs: number };
  /** Called only when the activity state changes. The engine starts out believing `active`. */
  onActivity: (state: Activity) => void;
  /** Typing-busy: active and idle for less than `busyIdleMs`. Called only on change. */
  onBusy: (busy: boolean) => void;
  intervalMs?: number;
}

export interface IdleMonitor {
  start(): void;
  stop(): void;
  /** Screen lock and unlock; the main process wires this to powerMonitor's `lock-screen` and `unlock-screen`. */
  setLocked(locked: boolean): void;
}

export function createIdleMonitor(opts: IdleOptions): IdleMonitor {
  const intervalMs = opts.intervalMs ?? 5000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let locked = false;
  let activity: Activity = 'active';
  let busy = false;

  function poll(): void {
    const idleMs = opts.idleSeconds() * 1000;
    const nextActivity: Activity = locked ? 'locked' : idleMs >= opts.tuning.awayIdleMs ? 'away' : 'active';
    const nextBusy = nextActivity === 'active' && idleMs < opts.tuning.busyIdleMs;
    if (nextActivity !== activity) {
      activity = nextActivity;
      opts.onActivity(activity);
    }
    if (nextBusy !== busy) {
      busy = nextBusy;
      opts.onBusy(busy);
    }
  }

  return {
    start() {
      if (timer !== null) return;
      poll();
      timer = setInterval(poll, intervalMs);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    setLocked(next) {
      if (next === locked) return;
      locked = next;
      poll();
    },
  };
}
