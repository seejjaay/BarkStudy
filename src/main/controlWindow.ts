import { BrowserWindow, type WebContents } from 'electron';
import { CONTROL_CHANNEL, type ControlEvent } from '../shared/control';
import type { Log } from './logs';
import { windowIcon } from './windowIcon';
import { UI_PARTITION } from './network';

export interface ControlWindow {
  /** Creates the window on first use, then shows and focuses it. */
  show: () => void;
  send: (event: ControlEvent) => void;
  /** The native window, for dialogs that need a parent. Null until first shown. */
  window: () => BrowserWindow | null;
  /** True only for the control window's own page. */
  isOwn: (sender: WebContents) => boolean;
  /** The window really closes from now on (the app is quitting). */
  allowClose: () => void;
  readonly visible: boolean;
  dispose: () => void;
}

export function createControlWindow(opts: { preload: string; load: (w: BrowserWindow) => Promise<void>; log?: Pick<Log, 'error'> }): ControlWindow {
  let win: BrowserWindow | null = null;
  let closing = false;
  // Events sent before the page has loaded are replayed once it has, newest of each kind only.
  const latest = new Map<ControlEvent['type'], ControlEvent>();

  function create(): BrowserWindow {
    const w = new BrowserWindow({
      width: 980,
      height: 700,
      minWidth: 720,
      minHeight: 520,
      show: false,
      title: 'BarkStudy',
      backgroundColor: '#f6efe4',
      icon: windowIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: opts.preload,
        partition: UI_PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // Closing hides it: the app keeps running (the overlay and a session live on), and a second launch brings it back.
    w.on('close', (event) => {
      if (closing) return;
      event.preventDefault();
      w.hide();
    });
    w.on('closed', () => {
      if (win === w) win = null;
    });
    w.webContents.on('did-finish-load', () => {
      if (w.isDestroyed()) return;
      for (const e of latest.values()) w.webContents.send(CONTROL_CHANNEL.event, e);
    });
    if (process.env['BARKSTUDY_DEBUG']) {
      w.webContents.on('console-message', (event) => console.log('[control]', event.message));
      w.webContents.on('preload-error', (_e, path, err) => console.log('[control] preload error', path, err));
      w.webContents.on('did-fail-load', (_e, code, desc) => console.log('[control] load failed', code, desc));
    }
    opts.load(w).then(
      () => {
        if (!w.isDestroyed()) w.show();
      },
      (err: unknown) => (opts.log ? opts.log.error('control', 'control window failed to load', err) : console.error('control window failed to load', err)),
    );
    return w;
  }

  return {
    show() {
      if (win === null || win.isDestroyed()) {
        win = create();
        return;
      }
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
    send(event) {
      latest.set(event.type, event);
      if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send(CONTROL_CHANNEL.event, event);
    },
    window: () => (win !== null && !win.isDestroyed() ? win : null),
    isOwn: (sender) => win !== null && !win.isDestroyed() && win.webContents === sender,
    allowClose() {
      closing = true;
    },
    get visible() {
      return win !== null && !win.isDestroyed() && win.isVisible();
    },
    dispose() {
      closing = true;
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
