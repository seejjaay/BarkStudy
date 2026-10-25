import type { TrackedWindow } from '../shared/geometry';

/**
 * Pandesal stays quiet (no prompts, no effects, no escalation) while the window in front is fullscreen or belongs to an
 * app on the excluded list. Only the foreground window counts: a game running behind the editor does not.
 */
export function isSuppressing(windows: readonly TrackedWindow[], excludedApps: readonly string[]): boolean {
  const front = windows.find((w) => w.isForeground);
  if (!front) return false;
  if (front.fullscreen) return true;
  const name = front.processName.toLowerCase();
  return excludedApps.some((app) => app.toLowerCase() === name);
}

export interface SuppressOptions {
  /** Read on every evaluation, so a settings change applies on the next `refresh()`. */
  excludedApps: () => readonly string[];
  /** Called only when the answer changes. */
  emit: (on: boolean) => void;
}

export interface Suppress {
  update(windows: readonly TrackedWindow[]): void;
  /** Re-evaluates the last window list, e.g. after the excluded-apps setting changed. */
  refresh(): void;
}

export function createSuppress(opts: SuppressOptions): Suppress {
  let windows: readonly TrackedWindow[] = [];
  let on = false;

  function evaluate(): void {
    const next = isSuppressing(windows, opts.excludedApps());
    if (next === on) return;
    on = next;
    opts.emit(on);
  }

  return {
    update(next) {
      windows = next;
      evaluate();
    },
    refresh: evaluate,
  };
}
