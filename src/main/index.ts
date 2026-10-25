import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, globalShortcut, ipcMain, powerMonitor, screen, session, systemPreferences, type Display } from 'electron';
import { DEFAULT_TUNING } from '../engine/tuning';
import { CONTROL_CHANNEL } from '../shared/control';
import type { DisplayInfo, RawWindow } from '../shared/geometry';
import { toDipWindows } from '../shared/geometry';
import { IPC } from '../shared/ipc';
import { createControlHandlers } from './controlHandlers';
import { createControlWindow } from './controlWindow';
import { installDebug } from './debug';
import { createDogHost } from './dogHost';
import { createFileAccess } from './files';
import { createIdleMonitor } from './idle';
import { createLibrary } from './library';
import { hardenWebContents, installNetworkGuard, UI_PARTITION } from './network';
import { createOverlayManager } from './overlay';
import { createSessionController } from './session';
import { createStorage } from './storage/io';
import { createSuppress } from './suppress';
import { createTracker, lazyWin32 } from './tracker/tracker';
import { realWin32 } from './tracker/win32';

const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
const devOrigin = rendererUrl ? new URL(rendererUrl).origin : null;
// Tests drive the app through a debug surface and track our own windows; never in a packaged build.
const e2e = process.env['BARKSTUDY_E2E'] === '1' && !app.isPackaged;

// Tests must never touch the real decks and history.
if (e2e) app.setPath('userData', process.env['BARKSTUDY_USER_DATA'] ?? join(tmpdir(), `barkstudy-e2e-${process.pid}`));

const toInfo = (d: Display): DisplayInfo => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor });

// A second launch brings the first one's control window forward instead of starting another dog.
const firstInstance = e2e || app.requestSingleInstanceLock();
if (!firstInstance) app.quit();

void (firstInstance ? app.whenReady() : Promise.resolve()).then(async () => {
  if (!firstInstance) return;
  installNetworkGuard(session.fromPartition(UI_PARTITION), devOrigin);
  app.on('web-contents-created', (_event, wc) => hardenWebContents(wc, devOrigin));

  const library = await createLibrary({ storage: createStorage(join(app.getPath('userData'), 'data')) });

  const controlWindow = createControlWindow({
    preload: join(__dirname, '../preload/control.cjs'),
    load: (win) => (rendererUrl ? win.loadURL(`${rendererUrl}/control/index.html`) : win.loadFile(join(__dirname, '../renderer/control/index.html'))),
  });
  let trackerDown = false;

  const studySession = createSessionController({
    library,
    seed: Date.now() % 2 ** 31,
    publish: (view) => controlWindow.send({ type: 'session', view }),
  });
  const handlers = createControlHandlers({
    library,
    session: studySession,
    files: createFileAccess(() => controlWindow.window()),
    trackerDown: () => trackerDown,
  });
  ipcMain.handle(CONTROL_CHANNEL.call, (event, message: unknown) => {
    if (!controlWindow.isOwn(event.sender)) throw new Error('not the control window');
    const m = typeof message === 'object' && message !== null ? (message as { op?: unknown; args?: unknown }) : {};
    return handlers.handle(m.op, m.args);
  });
  app.on('second-instance', () => controlWindow.show());

  const suppress = createSuppress({
    excludedApps: () => library.getSettings().excludedApps,
    emit: (on) => studySession.dispatch({ type: 'SUPPRESS_CHANGED', on }),
  });
  const idle = createIdleMonitor({
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    tuning: DEFAULT_TUNING,
    onActivity: (state) => studySession.dispatch({ type: 'USER_ACTIVITY', state }),
    onBusy: (busy) => studySession.setBusy(busy),
  });
  powerMonitor.on('lock-screen', () => idle.setLocked(true));
  powerMonitor.on('unlock-screen', () => idle.setLocked(false));

  const overlays = createOverlayManager({
    preload: join(__dirname, '../preload/overlay.cjs'),
    load: (win) => (rendererUrl ? win.loadURL(`${rendererUrl}/overlay/index.html`) : win.loadFile(join(__dirname, '../renderer/overlay/index.html'))),
  });
  const dogHost = createDogHost({ seed: Date.now() % 2 ** 31, sink: { send: (id, frame) => overlays.send(id, frame) } });
  let rawWindows: RawWindow[] = [];

  function pushWorld(): void {
    const displays = screen.getAllDisplays().map(toInfo);
    const tracked = toDipWindows(rawWindows, (r) => screen.screenToDipRect(null, r), displays);
    dogHost.setWorld(tracked, displays);
    suppress.update(tracked);
    studySession.setActiveWindow(tracked.find((w) => w.isForeground)?.id ?? null);
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

  const tracker = createTracker(lazyWin32(realWin32), {
    excludePid: e2e ? null : process.pid,
    excludeIds: () => overlays.hwnds(),
    onChange: (windows) => {
      rawWindows = windows;
      pushWorld();
    },
    onDown: (err) => {
      console.error('window tracker is down; roaming the display edges', err);
      trackerDown = true;
      dogHost.setTrackerDown();
      controlWindow.send({ type: 'status', trackerDown: true });
    },
  });

  screen.on('display-added', displaysChanged);
  screen.on('display-removed', displaysChanged);
  screen.on('display-metrics-changed', displaysChanged);

  // Until the tray arrives (T3.9) this is the way out: the overlay is click-through, so there is nothing to close.
  if (!e2e && !globalShortcut.register('Control+Alt+Q', () => app.quit())) console.error('Ctrl+Alt+Q is taken; quit from the terminal instead');
  if (e2e) installDebug({ dogHost, tracker, overlays, session: studySession });

  displaysChanged();
  tracker.start();
  idle.start();
  if (process.env['BARKSTUDY_NO_CONTROL'] !== '1') controlWindow.show();

  // Quitting mid-session must not lose it: finish the session and let pending review saves land first.
  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    void (async () => {
      try {
        if (studySession.view().phase === 'running') await studySession.end();
        await studySession.settled();
      } catch (err) {
        console.error('could not finish the session before quitting', err);
      }
      tracker.stop();
      idle.stop();
      studySession.dispose();
      dogHost.dispose();
      overlays.dispose();
      controlWindow.dispose();
      globalShortcut.unregisterAll();
      app.quit();
    })();
  });
});

// The overlays are not windows the user can close; the app lives until it is quit.
app.on('window-all-closed', () => {});
