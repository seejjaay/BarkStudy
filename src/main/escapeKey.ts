import type { Clock } from './dogHost';

/**
 * The global Escape key, held only while a visual effect (laps, dig-in) runs so Pandesal's effects can be cancelled
 * from any app without ever stealing Esc from other apps the rest of the time. It is released when the effect ends,
 * when the key is pressed, on dispose, or by a hard timer at the effect's max plus a grace period, so a lost
 * END_EFFECT can never leave Esc held.
 */

export const ESCAPE_GRACE_MS = 500;

const ESCAPE = 'Escape';

export interface EscapeKeyDeps {
  hotkeys: { register: (accelerator: string, onPress: () => void) => boolean; unregister: (accelerator: string) => void };
  clock?: Clock;
  /** Called once per press, after the key has been released. */
  onPress: () => void;
}

export interface EscapeKey {
  /** An effect began and will run at most `maxMs`. Holds Esc and (re)arms the hard timer at maxMs + ESCAPE_GRACE_MS. */
  effectStarted: (maxMs: number) => void;
  /** The effect is over for any reason. Releases Esc. */
  effectEnded: () => void;
  readonly held: boolean;
  dispose: () => void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createEscapeKey(deps: EscapeKeyDeps): EscapeKey {
  const { hotkeys, onPress } = deps;
  const clock = deps.clock ?? systemClock;
  let held = false;
  let timer: unknown = null;
  let reported = false;

  function clearTimer(): void {
    if (timer === null) return;
    clock.clearTimeout(timer);
    timer = null;
  }

  function release(): void {
    clearTimer();
    if (!held) return;
    held = false;
    hotkeys.unregister(ESCAPE);
  }

  function press(): void {
    if (!held) return;
    release();
    onPress();
  }

  function acquire(): boolean {
    if (held) return true;
    let ok: boolean;
    try {
      ok = hotkeys.register(ESCAPE, press);
    } catch {
      ok = false; // an accelerator Electron rejects is as unusable as a taken one
    }
    if (ok) {
      held = true;
      reported = false;
    } else if (!reported) {
      reported = true;
      console.error('Escape could not be registered; the effect will run to its end without it');
    }
    return held;
  }

  return {
    effectStarted(maxMs) {
      if (!acquire()) return;
      clearTimer();
      const limit = Number.isFinite(maxMs) ? Math.max(0, maxMs) : 0; // a bad max releases early rather than holding Esc
      timer = clock.setTimeout(() => {
        timer = null; // fired: nothing left to clear
        release();
      }, limit + ESCAPE_GRACE_MS);
    },

    effectEnded: release,

    get held() {
      return held;
    },

    dispose: release,
  };
}
