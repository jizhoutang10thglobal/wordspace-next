const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDocContent: () => ipcRenderer.invoke('get-doc-content'),
});
