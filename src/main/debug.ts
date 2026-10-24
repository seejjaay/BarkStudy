import type { DogHost } from './dogHost';
import type { OverlayManager } from './overlay';
import type { Tracker } from './tracker/tracker';

/**
 * A small control surface for the e2e tests, installed only when BARKSTUDY_E2E=1 on an unpackaged app.
 * Playwright reads it with `electronApp.evaluate`.
 */
export function installDebug(deps: { dogHost: DogHost; tracker: Tracker; overlays: OverlayManager }): void {
  (globalThis as { __barkDebug?: unknown }).__barkDebug = {
    body: () => deps.dogHost.body(),
    mode: () => deps.dogHost.mode,
    placeOn: (windowId: number) => deps.dogHost.placeOn(windowId),
    freeze: (on: boolean) => deps.dogHost.setRoaming(!on),
    killTracker: () => deps.tracker.kill('e2e'),
    overlayCount: () => deps.overlays.count(),
  };
}
