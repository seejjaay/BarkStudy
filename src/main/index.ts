import { join } from 'node:path';
import { app, globalShortcut, ipcMain, screen, session, systemPreferences, type Display } from 'electron';
import type { DisplayInfo, RawWindow } from '../shared/geometry';
import { toDipWindows } from '../shared/geometry';
import { IPC } from '../shared/ipc';
import { installDebug } from './debug';
import { createDogHost } from './dogHost';
import { hardenWebContents, installNetworkGuard, UI_PARTITION } from './network';
import { createOverlayManager } from './overlay';
import { createTracker } from './tracker/tracker';
import { realWin32 } from './tracker/win32';

const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
const devOrigin = rendererUrl ? new URL(rendererUrl).origin : null;
// Tests drive the app through a debug surface and track our own windows; never in a packaged build.
const e2e = process.env['BARKSTUDY_E2E'] === '1' && !app.isPackaged;

const toInfo = (d: Display): DisplayInfo => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor });

void app.whenReady().then(() => {
  installNetworkGuard(session.fromPartition(UI_PARTITION), devOrigin);
  app.on('web-contents-created', (_event, wc) => hardenWebContents(wc, devOrigin));

  const overlays = createOverlayManager({
    preload: join(__dirname, '../preload/overlay.cjs'),
    load: (win) => (rendererUrl ? win.loadURL(`${rendererUrl}/overlay/index.html`) : win.loadFile(join(__dirname, '../renderer/overlay/index.html'))),
  });
  const dogHost = createDogHost({ seed: Date.now() % 2 ** 31, sink: { send: (id, frame) => overlays.send(id, frame) } });
  let rawWindows: RawWindow[] = [];

  function pushWorld(): void {
    const displays = screen.getAllDisplays().map(toInfo);
    dogHost.setWorld(
      toDipWindows(rawWindows, (r) => screen.screenToDipRect(null, r), displays),
      displays,
    );
  }

  function displaysChanged(): void {
    overlays.sync(screen.getAllDisplays());
    try {
      dogHost.setReducedMotion(systemPreferences.getAnimationSettings().prefersReducedMotion);
    } catch {
      // Older Windows builds: keep the default.
    }
    pushWorld();
  }

  ipcMain.on(IPC.overlayHit, (event, message: unknown) => overlays.handleHit(event.sender, message));

  const tracker = createTracker(realWin32(), {
    excludePid: e2e ? null : process.pid,
    excludeIds: () => overlays.hwnds(),
    onChange: (windows) => {
      rawWindows = windows;
      pushWorld();
    },
    onDown: (err) => {
      console.error('window tracker is down; roaming the display edges', err);
      dogHost.setTrackerDown();
    },
  });

  screen.on('display-added', displaysChanged);
  screen.on('display-removed', displaysChanged);
  screen.on('display-metrics-changed', displaysChanged);

  // Until the tray arrives (M3) this is the way out: the overlay is click-through, so there is nothing to close.
  if (!e2e && !globalShortcut.register('Control+Alt+Q', () => app.quit())) console.error('Ctrl+Alt+Q is taken; quit from the terminal instead');
  if (e2e) installDebug({ dogHost, tracker, overlays });

  displaysChanged();
  tracker.start();

  app.on('before-quit', () => {
    tracker.stop();
    dogHost.dispose();
    overlays.dispose();
    globalShortcut.unregisterAll();
  });
});

// The overlays are not windows the user can close; the app lives until it is quit.
app.on('window-all-closed', () => {});
