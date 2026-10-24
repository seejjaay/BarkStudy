const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  onDraw: (cb) => ipcRenderer.on('draw', (_e, state) => cb(state)),
  onFocusInput: (cb) => ipcRenderer.on('focus-input', () => cb()),
  hit: (over) => ipcRenderer.send('hit', over),
  dogClick: () => ipcRenderer.send('dog-click'),
  focusBubble: () => ipcRenderer.send('focus-bubble'),
  submit: (value) => ipcRenderer.send('submit', value),
});
