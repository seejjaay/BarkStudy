import { contextBridge, ipcRenderer } from 'electron';
import { CONTROL_CHANNEL, type BarkControlApi, type ControlEvent } from '../shared/control';

const api: BarkControlApi = {
  call: (op, args) => ipcRenderer.invoke(CONTROL_CHANNEL.call, { op, args }) as ReturnType<BarkControlApi['call']>,
  onEvent: (cb) => {
    ipcRenderer.on(CONTROL_CHANNEL.event, (_event, e: ControlEvent) => cb(e));
  },
};

contextBridge.exposeInMainWorld('barkControl', api);

// Uncaught errors and rejected promises in the page go to main's app log. A page's errors are only reported to listeners
// in the page's own world, so the listeners are installed there; they hold the only reference to `reportError`, which
// is not part of the exposed API. Main checks the sender and the fields anyway. (Written out in both preloads on
// purpose: a module they shared would be built as a separate chunk, which a sandboxed preload cannot load.)
const reportError = (message: string, stack?: string): void => {
  try {
    ipcRenderer.send(CONTROL_CHANNEL.logRenderer, { message, stack });
  } catch {
    // Nothing more can be done from here.
  }
};
contextBridge.executeInMainWorld({
  func: (report: (message: string, stack?: string) => void) => {
    window.addEventListener('error', (e) => report(String(e.message || 'script error'), e.error instanceof Error ? String(e.error.stack) : undefined));
    window.addEventListener('unhandledrejection', (e) => {
      const r: unknown = e.reason;
      report(r instanceof Error ? String(r.message) : 'unhandled rejection: ' + String(r), r instanceof Error ? String(r.stack) : undefined);
    });
  },
  args: [reportError],
});
