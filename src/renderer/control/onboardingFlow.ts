import type { TraitPreset } from '../../engine/tuning';
import type { Cap } from '../../engine/types';
import type { Settings } from '../../shared/settings';

/** The first-run steps as plain data and one reducer, so the order, the gates and the first-run rule can be tested without a screen. */

export type Step = 'meet' | 'personality' | 'escape' | 'privacy' | 'login' | 'sample';

export const STEPS: readonly Step[] = ['meet', 'personality', 'escape', 'privacy', 'login', 'sample'];

export interface Flow {
  step: Step;
  cap: Cap;
  preset: TraitPreset;
  updateChecks: boolean;
  /** Add Pandesal's starter deck when finishing. */
  sampleDeck: boolean;
  /** Start-with-Windows is only offered in the installed app, so its step may not exist. */
  loginAvailable: boolean;
  /** Leave it was pressed once in practice, or the user chose to go on without. */
  leaveItSeen: boolean;
  /** Another app owns the Leave it shortcut right now. */
  leaveItBlocked: boolean;
}

export type Action =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'set'; patch: Partial<Pick<Flow, 'cap' | 'preset' | 'updateChecks' | 'sampleDeck'>> }
  | { type: 'leaveItPressed' }
  | { type: 'leaveItConflict'; on: boolean }
  | { type: 'continueAnyway' };

export function visibleSteps(loginAvailable: boolean): Step[] {
  return STEPS.filter((s) => s !== 'login' || loginAvailable);
}

/** Starts from what is saved now, so running setup again shows the user's own choices. */
export function initialFlow(s: Settings, loginAvailable: boolean, hasSampleDeck: boolean): Flow {
  return {
    step: 'meet',
    cap: s.cap,
    preset: s.preset,
    updateChecks: s.updateChecks,
    sampleDeck: !hasSampleDeck,
    loginAvailable,
    leaveItSeen: false,
    leaveItBlocked: false,
  };
}

/** The Leave it step is a gate: he is never started without the user having felt the way out. */
export function canAdvance(f: Flow): boolean {
  return f.step !== 'escape' || f.leaveItSeen;
}

export function reduce(f: Flow, a: Action): Flow {
  const steps = visibleSteps(f.loginAvailable);
  const at = steps.indexOf(f.step);
  switch (a.type) {
    case 'next':
      return canAdvance(f) && at < steps.length - 1 ? { ...f, step: steps[at + 1]! } : f;
    case 'back':
      return at > 0 ? { ...f, step: steps[at - 1]! } : f;
    case 'set':
      return { ...f, ...a.patch };
    case 'leaveItPressed':
    case 'continueAnyway':
      return { ...f, leaveItSeen: true };
    case 'leaveItConflict':
      return { ...f, leaveItBlocked: a.on };
  }
}

/**
 * Onboarding is for a real first run only. A snapshot that is still loading or failed to load is not one, and neither is
 * one where the settings file was damaged or unreadable: its "not onboarded" is an empty fallback, not a new user.
 */
export function shouldOnboard(
  load: { status: 'loading' | 'error' | 'ready' },
  snapshot: { onboarded: boolean; notices: readonly { store: string; kind: string }[] } | null,
): boolean {
  if (load.status !== 'ready' || snapshot === null) return false;
  return !snapshot.onboarded && !snapshot.notices.some((n) => n.store === 'settings');
}
