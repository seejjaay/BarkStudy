import type { RawWindow, Rect } from '../../shared/geometry';

/** A window as Win32 reports it: physical pixels, already filtered (visible, not a tool window, not cloaked or minimized, non-empty). */
export interface Win32Window {
  id: number;
  pid: number;
  bounds: Rect;
  processName: string;
}

export interface Win32Api {
  /** Top-first z-order. */
  listWindows: () => Win32Window[];
  foreground: () => number;
  /** Calls `onEvent` for window changes; returns an unhook function. */
  hook: (onEvent: () => void) => () => void;
}

/**
 * Builds the Win32 binding on first use. If building it throws (koffi missing or blocked), the tracker's own
 * error handling reports it as "down", so the app starts and roams the display edges instead of dying at startup.
 */
export function lazyWin32(create: () => Win32Api): Win32Api {
  let api: Win32Api | null = null;
  const get = (): Win32Api => (api ??= create());
  return {
    listWindows: () => get().listWindows(),
    foreground: () => get().foreground(),
    hook: (onEvent) => get().hook(onEvent),
  };
}

export interface TrackerOptions {
  /** Windows of this process are skipped. Null tracks everything (e2e only). */
  excludePid: number | null;
  /** Extra window ids to skip, read on every refresh (our own overlays). */
  excludeIds: () => ReadonlySet<number>;
  onChange: (windows: RawWindow[]) => void;
  /** The tracker failed and has stopped. Called at most once. */
  onDown: (err: unknown) => void;
  /** Hook events within this window collapse into one refresh. Default 16. */
  coalesceMs?: number;
  /** The whole list is re-read this often, to catch missed events or a dead hook. Default 1000. */
  reconcileMs?: number;
}

export interface Tracker {
  start(): void;
  stop(): void;
  /** Fails the tracker on purpose (tests, or a watchdog). */
  kill(reason: string): void;
  readonly running: boolean;
}

export function createTracker(api: Win32Api, opts: TrackerOptions): Tracker {
  const coalesceMs = opts.coalesceMs ?? 16;
  const reconcileMs = opts.reconcileMs ?? 1000;
  let running = false;
  let unhook: (() => void) | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let reconcile: ReturnType<typeof setInterval> | null = null;
  let lastKey: string | null = null;

  function teardown(): void {
    running = false;
    if (pending !== null) clearTimeout(pending);
    if (reconcile !== null) clearInterval(reconcile);
    pending = null;
    reconcile = null;
    const u = unhook;
    unhook = null;
    try {
      u?.();
    } catch {
      // Already failing or stopping; nothing more to do.
    }
  }

  function fail(err: unknown): void {
    if (!running) return;
    teardown();
    opts.onDown(err);
  }

  function refresh(): void {
    if (!running) return;
    try {
      const fg = api.foreground();
      const skip = opts.excludeIds();
      const list: RawWindow[] = api
        .listWindows()
        .filter((win) => (opts.excludePid === null || win.pid !== opts.excludePid) && !skip.has(win.id))
        .map((win) => ({ id: win.id, bounds: win.bounds, processName: win.processName, isForeground: win.id === fg }));
      const key = JSON.stringify(list);
      if (key === lastKey) return;
      lastKey = key;
      opts.onChange(list);
    } catch (err) {
      fail(err);
    }
  }

  function schedule(): void {
    if (!running || pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      refresh();
    }, coalesceMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastKey = null;
      try {
        unhook = api.hook(schedule);
      } catch (err) {
        fail(err);
        return;
      }
      refresh();
      if (running) reconcile = setInterval(refresh, reconcileMs);
    },
    stop() {
      teardown();
    },
    kill(reason) {
      fail(new Error(reason));
    },
    get running() {
      return running;
    },
  };
}
