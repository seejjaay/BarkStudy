import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, globalShortcut, ipcMain, Notification, powerMonitor, screen, session, systemPreferences, type Display, type WebContents } from 'electron';
import { DEFAULT_TUNING } from '../engine/tuning';
import { BUBBLE_HOTKEY } from '../shared/bubble';
import { CONTROL_CHANNEL, type AppStatus } from '../shared/control';
import type { DisplayInfo, RawWindow } from '../shared/geometry';
import { toDipWindows } from '../shared/geometry';
import { IPC } from '../shared/ipc';
import { createBubbleHost } from './bubbleHost';
import { createControlHandlers } from './controlHandlers';
import { createControlWindow } from './controlWindow';
import { installDebug } from './debug';
import { createDogHost } from './dogHost';
import { createFileAccess } from './files';
import { createIdleMonitor } from './idle';
import { createLeaveIt } from './leaveIt';
import { createLibrary } from './library';
import { hardenWebContents, installNetworkGuard, UI_PARTITION } from './network';
import { createOverlayManager } from './overlay';
import { createSessionController } from './session';
import { createStorage } from './storage/io';
import { createSuppress } from './suppress';
import { createTray } from './tray';
import { runTrayAction } from './trayModel';
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

  const overlays = createOverlayManager({
    preload: join(__dirname, '../preload/overlay.cjs'),
    load: (win) => (rendererUrl ? win.loadURL(`${rendererUrl}/overlay/index.html`) : win.loadFile(join(__dirname, '../renderer/overlay/index.html'))),
  });

  const notify = (message: string): void => {
    if (Notification.isSupported()) new Notification({ title: 'BarkStudy', body: message, silent: true }).show();
  };
  const appStatus = (): AppStatus => ({ trackerDown, leaveItConflict: leaveIt.conflict, leaveItLabel: leaveIt.accelerator ?? library.getSettings().leaveItHotkey });
  const publishStatus = (): void => {
    controlWindow.send({ type: 'status', ...appStatus() });
    appTray.refresh();
  };

  const studySession = createSessionController({
    library,
    seed: Date.now() % 2 ** 31,
    publish: (view) => {
      controlWindow.send({ type: 'session', view });
      appTray.refresh();
    },
    publishBubble: (state) => bubble.onBubbleChanged(state),
  });
  // Leave it is registered from the saved setting, and is always on; the tray menu offers the same action.
  const leaveIt = createLeaveIt({
    session: studySession,
    hotkeys: {
      register: (accelerator, onPress) => globalShortcut.register(accelerator, onPress),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    notify,
    onConflictChange: () => publishStatus(),
  });
  const appTray = createTray({
    inputs: () => ({
      view: studySession.view(),
      decks: library.listDecks(),
      leaveItLabel: leaveIt.accelerator ?? library.getSettings().leaveItHotkey,
      leaveItConflict: leaveIt.conflict,
      trackerDown,
      soundOn: library.getSettings().soundOn,
      volume: library.getSettings().volume,
    }),
    onOpen: () => controlWindow.show(),
    onAction: (action) =>
      void runTrayAction(action, { session: studySession, library, openControl: () => controlWindow.show(), quit: () => app.quit(), notify }).then(() => appTray.refresh()),
  });
  const bubble = createBubbleHost({
    session: studySession,
    overlays: {
      broadcast: (channel, payload) => overlays.broadcast(channel, payload),
      isOverlay: (sender) => overlays.isOverlay(sender as WebContents),
      setFocus: (sender, on) => overlays.setFocus(sender as WebContents, on),
    },
    hotkeys: {
      register: (accelerator, onPress) => globalShortcut.register(accelerator, onPress),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
  });
  for (const channel of [IPC.bubbleSubmit, IPC.bubbleReveal, IPC.bubbleGrade]) {
    ipcMain.handle(channel, (event, payload: unknown) => bubble.handle(channel, event.sender, payload));
  }
  for (const channel of [IPC.bubbleDismiss, IPC.bubbleOpen, IPC.bubbleFocus]) {
    ipcMain.on(channel, (event, payload: unknown) => void bubble.handle(channel, event.sender, payload));
  }
  const handlers = createControlHandlers({
    library,
    session: studySession,
    files: createFileAccess(() => controlWindow.window()),
    status: appStatus,
  });
  ipcMain.handle(CONTROL_CHANNEL.call, async (event, message: unknown) => {
    if (!controlWindow.isOwn(event.sender)) throw new Error('not the control window');
    const m = typeof message === 'object' && message !== null ? (message as { op?: unknown; args?: unknown }) : {};
    const result = await handlers.handle(m.op, m.args);
    appTray.refresh(); // decks may have been added or removed
    return result;
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
      publishStatus();
    },
  });

  screen.on('display-added', displaysChanged);
  screen.on('display-removed', displaysChanged);
  screen.on('display-metrics-changed', displaysChanged);

  // The tray is the way out now: the overlay is click-through, so there is nothing to close.
  leaveIt.register(library.getSettings().leaveItHotkey);
  appTray.refresh();
  if (e2e) {
    installDebug({
      dogHost,
      tracker,
      overlays,
      session: studySession,
      bubbleHotkeyRegistered: () => globalShortcut.isRegistered(BUBBLE_HOTKEY),
      tray: appTray,
      leaveIt,
    });
  }

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
      bubble.dispose();
      leaveIt.dispose();
      appTray.dispose();
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
