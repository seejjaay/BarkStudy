import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type BarkOverlayApi, type DogFrame } from '../shared/ipc';

const api: BarkOverlayApi = {
  onFrame: (cb) => {
    ipcRenderer.on(IPC.overlayFrame, (_event, frame: DogFrame | null) => cb(frame));
  },
  hit: (over) => {
    ipcRenderer.send(IPC.overlayHit, over);
  },
};

contextBridge.exposeInMainWorld('barkOverlay', api);
