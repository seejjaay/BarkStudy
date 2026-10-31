import { toggleLeaveIt } from './trayModel';
import type { SessionController } from './session';

/**
 * "Leave it": the global shortcut that pauses everything from any app. Unlike the bubble hotkey it is always
 * registered. If another app owns the shortcut that is reported (a banner in the control window, a note in the tray
 * menu), never swallowed, and the same action is still one click away in the tray.
 */

export interface LeaveItDeps {
  session: Pick<SessionController, 'view' | 'control'>;
  hotkeys: { register: (accelerator: string, onPress: () => void) => boolean; unregister: (accelerator: string) => void };
  /** A quiet message for when the shortcut is pressed with nothing to pause. */
  notify: (message: string) => void;
  /** Called whenever the conflict state changes, so the UI can follow. */
  onConflictChange: (conflict: boolean) => void;
  /** Offered a press that has no session to act on. Return true if it took the press (onboarding practice); false falls back to the quiet message. */
  idlePress?: () => boolean;
}

export interface LeaveIt {
  /** Registers the accelerator (Electron form, such as "Control+Alt+L"). Returns false if it is taken. */
  register: (accelerator: string) => boolean;
  /** Moves to another accelerator. If the new one is taken the old one stays, so the user is never left with none. */
  rebind: (accelerator: string) => boolean;
  readonly accelerator: string | null;
  readonly conflict: boolean;
  dispose: () => void;
}

export function createLeaveIt(deps: LeaveItDeps): LeaveIt {
  let current: string | null = null;
  let conflict = false;
  let attempted: string | null = null;

  function press(): void {
    if (toggleLeaveIt(deps.session) !== 'no-session') return;
    if (deps.idlePress?.() !== true) deps.notify('Leave it works while a session is running. Nothing to pause right now.');
  }

  function setConflict(next: boolean): void {
    if (next === conflict) return;
    conflict = next;
    deps.onConflictChange(conflict);
  }

  function tryRegister(accelerator: string): boolean {
    try {
      return deps.hotkeys.register(accelerator, press);
    } catch {
      return false; // an accelerator Electron cannot parse is just as unusable as a taken one
    }
  }

  return {
    register(accelerator) {
      attempted = accelerator;
      const ok = tryRegister(accelerator);
      if (ok) current = accelerator;
      setConflict(!ok);
      return ok;
    },

    rebind(accelerator) {
      if (accelerator === current) return true;
      attempted = accelerator;
      if (!tryRegister(accelerator)) {
        // Keep whatever worked before; only report if there was nothing.
        setConflict(current === null);
        return false;
      }
      if (current !== null) deps.hotkeys.unregister(current);
      current = accelerator;
      setConflict(false);
      return true;
    },

    get accelerator() {
      return current ?? attempted;
    },
    get conflict() {
      return conflict;
    },

    dispose() {
      if (current !== null) deps.hotkeys.unregister(current);
      current = null;
    },
  };
}
