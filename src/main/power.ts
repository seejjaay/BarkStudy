import type { Log } from './logs';

/** How often battery saver is read when nothing tells us it may have changed. */
export const POWER_POLL_MS = 30_000;

export interface PowerWatchOptions {
  /** True while Windows battery saver is on. May throw: that counts as off. */
  read: () => boolean;
  /** Called only when the value changes. */
  onChange: (on: boolean) => void;
  pollMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  log: Pick<Log, 'error'>;
}

export interface PowerWatch {
  /** Reads once now, then every pollMs. */
  start: () => void;
  /** Reads again at once: the power source changed, or the machine woke up. */
  refresh: () => void;
  /** Battery saver as the app acts on it: the override if there is one, else the last reading. */
  readonly on: boolean;
  /** e2e: pretend battery saver is on or off. Null hands back to the real reading, read again at once. */
  force: (on: boolean | null) => void;
  stop: () => void;
}

/** Watches Windows battery saver. A failed read means off, and is logged once until a read works again. */
export function createPowerWatch(opts: PowerWatchOptions): PowerWatch {
  const pollMs = opts.pollMs ?? POWER_POLL_MS;
  const every = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const cancel = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  let reading = false;
  let forced: boolean | null = null;
  let shown = false;
  let failing = false;
  let timer: unknown = null;

  function publish(): void {
    const on = forced ?? reading;
    if (on === shown) return;
    shown = on;
    opts.onChange(on);
  }

  function read(): void {
    try {
      reading = opts.read();
      failing = false;
    } catch (err) {
      reading = false;
      if (!failing) opts.log.error('power', 'could not read the battery saver state; treating it as off', err);
      failing = true;
    }
    publish();
  }

  return {
    start() {
      if (timer !== null) return;
      read();
      timer = every(read, pollMs);
    },
    refresh: read,
    get on() {
      return shown;
    },
    force(on) {
      forced = on;
      if (on === null) read();
      else publish();
    },
    stop() {
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}
