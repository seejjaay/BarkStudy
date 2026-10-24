import { BrowserWindow, type Display, type WebContents } from 'electron';
import { IPC, isHitMessage, type DogFrame } from '../shared/ipc';
import { UI_PARTITION } from './network';

export interface OverlayManager {
  /** Creates, resizes and removes overlays so there is exactly one per display. */
  sync: (displays: readonly Display[]) => void;
  send: (displayId: number, frame: DogFrame | null) => void;
  /** Applies a hit-test message from an overlay renderer; ignores anything else. */
  handleHit: (sender: WebContents, message: unknown) => void;
  /** Native window handles of the overlays, so the tracker can leave them out. */
  hwnds: () => Set<number>;
  count: () => number;
  dispose: () => void;
}

export function createOverlayManager(opts: { preload: string; load: (w: BrowserWindow) => Promise<void> }): OverlayManager {
  const windows = new Map<number, BrowserWindow>();
  const lastFrames = new Map<number, DogFrame | null>();

  function create(d: Display): BrowserWindow {
    const win = new BrowserWindow({
      ...d.bounds,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: opts.preload,
        partition: UI_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setBounds(d.bounds);
    // A page that finishes loading after the dog went idle would otherwise stay empty: replay the last frame.
    win.webContents.on('did-finish-load', () => {
      const frame = lastFrames.get(d.id);
      if (frame !== undefined && !win.isDestroyed()) win.webContents.send(IPC.overlayFrame, frame);
    });
    win.webContents.on('render-process-gone', () => {
      if (!win.isDestroyed()) win.webContents.reload();
    });
    win.on('closed', () => {
      if (windows.get(d.id) === win) windows.delete(d.id);
    });
    opts.load(win).then(
      () => {
        if (!win.isDestroyed()) win.showInactive();
      },
      (err: unknown) => console.error('overlay failed to load', err),
    );
    return win;
  }

  return {
    sync(displays) {
      const wanted = new Set(displays.map((d) => d.id));
      for (const [id, win] of windows) {
        if (!wanted.has(id)) {
          windows.delete(id);
          lastFrames.delete(id);
          if (!win.isDestroyed()) win.destroy();
        }
      }
      for (const d of displays) {
        const existing = windows.get(d.id);
        if (existing && !existing.isDestroyed()) existing.setBounds(d.bounds);
        else windows.set(d.id, create(d));
      }
    },
    send(displayId, frame) {
      lastFrames.set(displayId, frame);
      const win = windows.get(displayId);
      if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send(IPC.overlayFrame, frame);
    },
    handleHit(sender, message) {
      if (!isHitMessage(message)) return;
      for (const win of windows.values()) {
        if (!win.isDestroyed() && win.webContents === sender) win.setIgnoreMouseEvents(!message, { forward: true });
      }
    },
    hwnds() {
      const ids = new Set<number>();
      for (const win of windows.values()) {
        if (!win.isDestroyed()) ids.add(Number(win.getNativeWindowHandle().readBigUInt64LE(0)));
      }
      return ids;
    },
    count: () => windows.size,
    dispose() {
      for (const win of windows.values()) if (!win.isDestroyed()) win.destroy();
      windows.clear();
      lastFrames.clear();
    },
  };
}
