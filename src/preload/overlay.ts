import { contextBridge, ipcRenderer } from 'electron';
import type { BubbleState, RevealResult, SelfGrade, SubmitResult } from '../shared/bubble';
import { IPC, type BarkOverlayApi, type DogFrame, type SpeechLine } from '../shared/ipc';

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
};

contextBridge.exposeInMainWorld('barkOverlay', api);
