const { contextBridge, ipcRenderer } = require('electron');
const themeManager = require('../lib/theme-manager');

contextBridge.exposeInMainWorld('api', {
  getDocContent: () => ipcRenderer.invoke('get-doc-content'),
  theme: {
    DEFAULT_THEME: themeManager.DEFAULT_THEME,
    toggleTheme: themeManager.toggleTheme,
    getShellClass: themeManager.getShellClass,
    getDocStyle: themeManager.getDocStyle,
  },
});
