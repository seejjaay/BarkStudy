import type { DogHost } from './dogHost';
import type { OverlayManager } from './overlay';
import type { SessionController } from './session';
import type { Tracker } from './tracker/tracker';

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
}): void {
  (globalThis as { __barkDebug?: unknown }).__barkDebug = {
    body: () => deps.dogHost.body(),
    mode: () => deps.dogHost.mode,
    placeOn: (windowId: number) => deps.dogHost.placeOn(windowId),
    freeze: (on: boolean) => deps.dogHost.setRoaming(!on),
    killTracker: () => deps.tracker.kill('e2e'),
    overlayCount: () => deps.overlays.count(),
    /** Makes the check-in due now, so a test need not wait minutes for the first card. */
    checkin: () => deps.session.dispatch({ type: 'CHECKIN_DUE' }),
    sessionView: () => deps.session.view(),
    bubbleState: () => deps.session.bubbleState(),
    bubbleHotkeyRegistered: () => deps.bubbleHotkeyRegistered(),
  };
}
