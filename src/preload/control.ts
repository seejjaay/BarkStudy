import { contextBridge, ipcRenderer } from 'electron';
import { CONTROL_CHANNEL, type BarkControlApi, type ControlEvent } from '../shared/control';

const api: BarkControlApi = {
  call: (op, args) => ipcRenderer.invoke(CONTROL_CHANNEL.call, { op, args }) as ReturnType<BarkControlApi['call']>,
  onEvent: (cb) => {
    ipcRenderer.on(CONTROL_CHANNEL.event, (_event, e: ControlEvent) => cb(e));
  },
};

contextBridge.exposeInMainWorld('barkControl', api);
