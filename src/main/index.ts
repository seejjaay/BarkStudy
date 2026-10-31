import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, globalShortcut, ipcMain, Notification, powerMonitor, screen, session, shell, systemPreferences, type Display, type WebContents } from 'electron';
import { DEFAULT_TUNING } from '../engine/tuning';
import type { Settings } from '../shared/settings';
import { CONTROL_CHANNEL, type AppStatus } from '../shared/control';
import type { DisplayInfo, RawWindow } from '../shared/geometry';
import { toDipWindows } from '../shared/geometry';
import { IPC, type SoundCue } from '../shared/ipc';
import { createBubbleHost } from './bubbleHost';
import { createControlHandlers } from './controlHandlers';
import { createControlWindow } from './controlWindow';
import { createDebugRecorder, installDebug, type Hotkeys } from './debug';
import { createDogHost } from './dogHost';
import { createEscapeKey } from './escapeKey';
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

// The engine picks between intents at random (laps or a whine at level 3); an e2e test pins the seed so the ladder it
// watches is always the same one.
const e2eSeed = e2e ? Number.parseInt(process.env['BARKSTUDY_SEED'] ?? '', 10) : Number.NaN;
const seed = (): number => (Number.isSafeInteger(e2eSeed) ? e2eSeed : Date.now() % 2 ** 31);

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

  // What the e2e tests read back (moods, lines, shortcuts); null outside e2e, so nothing is recorded in real use.
  const recorder = e2e ? createDebugRecorder() : null;
  // The one adapter every global shortcut goes through: the bubble's, Leave it's and Esc's.
  const electronHotkeys: Hotkeys = {
    register: (accelerator, onPress) => globalShortcut.register(accelerator, onPress),
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
  };
  const hotkeys = recorder ? recorder.hotkeys(electronHotkeys) : electronHotkeys;

  // The session is created below; the dog only reports a lost effect from his own tick, long after this has all run.
  const dogHost = createDogHost({
    seed: Date.now() % 2 ** 31,
    sink: {
      send: (id, frame) => {
        overlays.send(id, frame);
        recorder?.frame(frame);
      },
    },
    cursor: () => screen.getCursorScreenPoint(),
    onEffectLost: () => studySession.effectLost(),
  });
  // Esc is held only while an effect runs; a press ends the effect and keeps the level.
  const escapeKey = createEscapeKey({ hotkeys, onPress: () => studySession.dispatch({ type: 'ESC_PRESSED' }) });

  const studySession = createSessionController({
    library,
    seed: seed(),
    publish: (view) => {
      controlWindow.send({ type: 'session', view });
      appTray.refresh();
    },
    publishBubble: (state) => bubble.onBubbleChanged(state),
    // Speech and sound go to every overlay; only the one that has him (a non-null frame) shows or plays them.
    presentation: {
      dog: dogHost,
      escape: escapeKey,
      speech: (line) => {
        overlays.broadcast(IPC.speechSay, line);
        recorder?.speech(line);
      },
      sound: (name, volume) => overlays.broadcast(IPC.soundPlay, { name, volume } satisfies SoundCue),
    },
    fastTuning: e2e && process.env['BARKSTUDY_FAST_TUNING'] === '1',
  });
  // Leave it is registered from the saved setting, and is always on; the tray menu offers the same action.
  const leaveIt = createLeaveIt({
    session: studySession,
    hotkeys,
    notify,
    onConflictChange: () => publishStatus(),
    idlePress: () => {
      if (!leaveItPractice) return false;
      controlWindow.send({ type: 'leave-it-pressed' });
      return true;
    },
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
    hotkeys,
    accelerator: () => library.getSettings().bubbleHotkey,
  });
  for (const channel of [IPC.bubbleSubmit, IPC.bubbleReveal, IPC.bubbleGrade]) {
    ipcMain.handle(channel, (event, payload: unknown) => bubble.handle(channel, event.sender, payload));
  }
  for (const channel of [IPC.bubbleDismiss, IPC.bubbleOpen, IPC.bubbleFocus]) {
    ipcMain.on(channel, (event, payload: unknown) => void bubble.handle(channel, event.sender, payload));
  }
  let rawWindows: RawWindow[] = [];
  // e2e only: a test cannot click a native dialog, so it names the file for the next backup export or restore instead.
  let nextDialogPath: string | null = null;
  const takeDialogPath = (): string | null => {
    const path = nextDialogPath;
    nextDialogPath = null;
    return path;
  };
  // While the first-run Leave it practice is on, a press with no session is the answer to "press it once".
  let leaveItPractice = false;
  // Follows the saved choice: "system" asks Windows, which is read again whenever the displays change.
  const applyReducedMotion = (mode: Settings['reducedMotion']): void => {
    try {
      dogHost.setReducedMotion(mode === 'system' ? systemPreferences.getAnimationSettings().prefersReducedMotion : mode === 'on');
    } catch {
      // Older Windows builds: keep the default.
    }
  };
  const handlers = createControlHandlers({
    library,
    session: studySession,
    files: createFileAccess(() => controlWindow.window(), e2e ? takeDialogPath : undefined),
    status: appStatus,
    platform: {
      // Start-with-Windows is for the installed app; a development run would register electron.exe.
      loginItem: {
        get: () => ({ available: app.isPackaged, on: app.isPackaged && app.getLoginItemSettings().openAtLogin }),
        set: (on) => app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] }),
      },
      openApps: () => [...new Set(rawWindows.map((w) => w.processName.toLowerCase()).filter((n) => n !== ''))].sort(),
      dataDir: join(app.getPath('userData'), 'data'),
      openLink: (url) => void shell.openExternal(url),
      applyReducedMotion,
      version: app.getVersion(),
      openPath: (path) => shell.openPath(path),
      // The saved shortcuts, reduced motion and tray follow the settings that were just swapped in.
      afterReplace: () => {
        const saved = library.getSettings();
        leaveIt.rebind(saved.leaveItHotkey);
        applyReducedMotion(saved.reducedMotion);
        publishStatus();
      },
      setPractice: (on) => {
        leaveItPractice = on;
      },
    },
    hotkeys: { leaveIt: { rebind: (a) => leaveIt.rebind(a) }, bubble: { rebind: (a) => bubble.rebind(a) } },
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
    // Under e2e the user always counts as present, so a test never starts 'away' because the machine sat idle.
    idleSeconds: () => (e2e ? 0 : powerMonitor.getSystemIdleTime()),
    tuning: DEFAULT_TUNING,
    onActivity: (state) => studySession.dispatch({ type: 'USER_ACTIVITY', state }),
    onBusy: (busy) => studySession.setBusy(busy),
  });
  powerMonitor.on('lock-screen', () => idle.setLocked(true));
  powerMonitor.on('unlock-screen', () => idle.setLocked(false));

  function pushWorld(): void {
    const displays = screen.getAllDisplays().map(toInfo);
    const tracked = toDipWindows(rawWindows, (r) => screen.screenToDipRect(null, r), displays);
    dogHost.setWorld(tracked, displays);
    suppress.update(tracked);
    studySession.setActiveWindow(tracked.find((w) => w.isForeground)?.id ?? null);
  }

  function displaysChanged(): void {
    overlays.sync(screen.getAllDisplays());
    applyReducedMotion(library.getSettings().reducedMotion);
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
  if (e2e && recorder) {
    installDebug({
      dogHost,
      tracker,
      overlays,
      session: studySession,
      bubbleHotkeyRegistered: () => globalShortcut.isRegistered(library.getSettings().bubbleHotkey),
      tray: appTray,
      leaveIt,
      escapeKey,
      recorder,
      library,
      setNextDialogPath: (path) => {
        nextDialogPath = path;
      },
    });
  }

  displaysChanged();
  tracker.start();
  idle.start();
  // A start-with-Windows launch passes --hidden: the dog and the tray come up, the window waits to be opened.
  if (process.env['BARKSTUDY_NO_CONTROL'] !== '1' && !process.argv.includes('--hidden')) controlWindow.show();

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
      escapeKey.dispose();
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
