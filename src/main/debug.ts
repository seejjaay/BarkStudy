import type { DogFrame, DogPose, SpeechLine } from '../shared/ipc';
import type { Mood } from '../shared/mood';
import type { Settings } from '../shared/settings';
import type { DogHost } from './dogHost';
import type { EscapeKey } from './escapeKey';
import type { LeaveIt } from './leaveIt';
import type { Library } from './library';
import type { OverlayManager } from './overlay';
import type { PowerWatch } from './power';
import type { SessionController } from './session';
import type { Tracker } from './tracker/tracker';
import type { AppTray } from './tray';

/** How many mood changes and lines the recorder keeps. */
export const DEBUG_LOG_CAPACITY = 200;

/** One change in how he is drawn. */
export interface MoodChange {
  mood: Mood;
  pose: DogPose;
  effect: 'laps' | 'dig' | null;
}

export interface Hotkeys {
  register: (accelerator: string, onPress: () => void) => boolean;
  unregister: (accelerator: string) => void;
}

/**
 * What the e2e tests read back about the presentation: his mood changes (from the frames he is drawn with), what he
 * said, and the global shortcuts as registered, so a test can press one. Built only under the e2e gate.
 */
export interface DebugRecorder {
  /** Every frame the dog host sends. Null frames (the displays he is not on) are skipped. */
  frame: (frame: DogFrame | null) => void;
  speech: (line: SpeechLine) => void;
  /** Wraps the app's one hotkeys adapter so every callback it registers can be pressed from a test. */
  hotkeys: (inner: Hotkeys) => Hotkeys;
  moodLog: () => MoodChange[];
  speechLog: () => SpeechLine[];
  /** Runs the callback registered for this accelerator as if the key were pressed. False if none is registered. */
  press: (accelerator: string) => boolean;
}

export function createDebugRecorder(capacity = DEBUG_LOG_CAPACITY): DebugRecorder {
  const moods: MoodChange[] = [];
  const lines: SpeechLine[] = [];
  const pressable = new Map<string, () => void>();
  const keep = <T>(list: T[], item: T): void => {
    list.push(item);
    while (list.length > capacity) list.shift();
  };

  return {
    frame(f) {
      if (!f) return;
      const change: MoodChange = { mood: f.mood, pose: f.pose, effect: f.effect?.kind ?? null };
      const last = moods.at(-1);
      // Only changes, so the log stays readable at 60 frames a second.
      if (last && last.mood === change.mood && last.pose === change.pose && last.effect === change.effect) return;
      keep(moods, change);
    },
    speech: (line) => keep(lines, line),
    hotkeys: (inner) => ({
      register(accelerator, onPress) {
        const ok = inner.register(accelerator, onPress);
        if (ok) pressable.set(accelerator, onPress);
        return ok;
      },
      unregister(accelerator) {
        inner.unregister(accelerator);
        pressable.delete(accelerator);
      },
    }),
    moodLog: () => moods.map((m) => ({ ...m })),
    speechLog: () => lines.map((l) => ({ ...l })),
    press(accelerator) {
      const onPress = pressable.get(accelerator);
      onPress?.();
      return onPress !== undefined;
    },
  };
}

/**
 * A small control surface for the e2e tests, installed only when BARKSTUDY_E2E=1 on an unpackaged app.
 * Playwright reads it with `electronApp.evaluate`.
 */
export function installDebug(deps: {
  dogHost: DogHost;
  tracker: Tracker;
  overlays: OverlayManager;
  session: SessionController;
  bubbleHotkeyRegistered: () => boolean;
  tray: AppTray;
  leaveIt: LeaveIt;
  escapeKey: EscapeKey;
  recorder: DebugRecorder;
  library: Library;
  power: Pick<PowerWatch, 'force'>;
  /** Makes the next backup open or save dialog use this path instead of showing a dialog, which a test cannot click. */
  setNextDialogPath: (path: string) => void;
}): void {
  (globalThis as { __barkDebug?: unknown }).__barkDebug = {
    body: () => deps.dogHost.body(),
    mode: () => deps.dogHost.mode,
    placeOn: (windowId: number) => deps.dogHost.placeOn(windowId),
    freeze: (on: boolean) => deps.dogHost.setRoaming(!on),
    /** Pretends battery saver is on or off; null hands back to the real reading. */
    setBatterySaver: (on: boolean | null) => deps.power.force(on),
    killTracker: () => deps.tracker.kill('e2e'),
    overlayCount: () => deps.overlays.count(),
    /** Makes the check-in due now, so a test need not wait minutes for the first card. */
    checkin: () => deps.session.dispatch({ type: 'CHECKIN_DUE' }),
    sessionView: () => deps.session.view(),
    bubbleState: () => deps.session.bubbleState(),
    bubbleHotkeyRegistered: () => deps.bubbleHotkeyRegistered(),
    /** The tray menu as built, and a way to click an item in it. */
    trayMenu: () => deps.tray.menuSpec(),
    trayRun: (id: string) => deps.tray.run(id),
    leaveIt: () => ({ accelerator: deps.leaveIt.accelerator, conflict: deps.leaveIt.conflict }),
    /** Gives up the shortcut and tries again, so a test can make another holder own it first. */
    leaveItReregister: (accelerator: string) => {
      deps.leaveIt.dispose();
      return deps.leaveIt.register(accelerator);
    },
    /** The last DEBUG_LOG_CAPACITY changes of mood, pose or effect, oldest first. */
    moodLog: () => deps.recorder.moodLog(),
    escapeHeld: () => deps.escapeKey.held,
    /** Runs a registered global shortcut's callback as if the key were pressed. False if nothing holds that key. */
    pressHotkey: (accelerator: string) => deps.recorder.press(accelerator),
    /** The last DEBUG_LOG_CAPACITY lines sent to the overlays, oldest first. */
    speechLog: () => deps.recorder.speechLog(),
    setNextDialogPath: (path: string) => deps.setNextDialogPath(path),
    /** Sets sound (or any other setting) the way the tray does, so a test does not depend on what an earlier one left. */
    updateSettings: async (patch: Partial<Settings>) => {
      const r = await deps.library.updateSettings(patch);
      deps.tray.refresh();
      return r;
    },
  };
}
