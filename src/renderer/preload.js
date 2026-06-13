const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ws2', {
  pickFile: () => ipcRenderer.invoke('pick-file'),
  readDoc: (p) => ipcRenderer.invoke('read-doc', p),
  saveDoc: (p, c) => ipcRenderer.invoke('save-doc', p, c),
  recents: () => ipcRenderer.invoke('recents-list'),
  recentsAdd: (p) => ipcRenderer.invoke('recents-add', p),
  historyList: (p) => ipcRenderer.invoke('history-list', p),
  historyRead: (p, id) => ipcRenderer.invoke('history-read', p, id),
  setDirty: (v) => ipcRenderer.send('set-dirty', v),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd))
});
