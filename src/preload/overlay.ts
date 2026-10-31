import { contextBridge, ipcRenderer } from 'electron';
import type { BubbleState, RevealResult, SelfGrade, SubmitResult } from '../shared/bubble';
import { IPC, type BarkOverlayApi, type DogFrame, type SoundCue, type SpeechLine } from '../shared/ipc';

const api: BarkOverlayApi = {
  onFrame: (cb) => {
    ipcRenderer.on(IPC.overlayFrame, (_event, frame: DogFrame | null) => cb(frame));
  },
  hit: (over) => {
    ipcRenderer.send(IPC.overlayHit, over);
  },
  onBubble: (cb) => {
    ipcRenderer.on(IPC.bubbleState, (_event, state: BubbleState | null) => cb(state));
  },
  onFocusInput: (cb) => {
    ipcRenderer.on(IPC.bubbleFocusInput, () => cb());
  },
  submit: (text) => ipcRenderer.invoke(IPC.bubbleSubmit, text) as Promise<SubmitResult>,
  reveal: () => ipcRenderer.invoke(IPC.bubbleReveal) as Promise<RevealResult>,
  grade: (grade: SelfGrade) => ipcRenderer.invoke(IPC.bubbleGrade, grade) as Promise<boolean>,
  dismiss: () => {
    ipcRenderer.send(IPC.bubbleDismiss);
  },
  open: () => {
    ipcRenderer.send(IPC.bubbleOpen);
  },
  focus: (on) => {
    ipcRenderer.send(IPC.bubbleFocus, on);
  },
  onSpeech: (cb) => {
    ipcRenderer.on(IPC.speechSay, (_event, line: SpeechLine) => cb(line));
  },
  onSound: (cb) => {
    ipcRenderer.on(IPC.soundPlay, (_event, cue: SoundCue) => cb(cue));
  },
};

contextBridge.exposeInMainWorld('barkOverlay', api);

// Uncaught errors and rejected promises in the page go to main's app log. A page's errors are only reported to listeners
// in the page's own world, so the listeners are installed there; they hold the only reference to `reportError`, which
// is not part of the exposed API. Main checks the sender and the fields anyway. (Written out in both preloads on
// purpose: a module they shared would be built as a separate chunk, which a sandboxed preload cannot load.)
const reportError = (message: string, stack?: string): void => {
  try {
    ipcRenderer.send(IPC.logRenderer, { message, stack });
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
