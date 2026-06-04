const { contextBridge, ipcRenderer } = require('electron');
const themeManager = require('../lib/theme-manager');

contextBridge.exposeInMainWorld('api', {
  getDocContent: () => ipcRenderer.invoke('get-doc-content'),
  theme: {
    toggle: (current) => themeManager.toggleTheme(current),
    getShellClass: (theme) => themeManager.getShellClass(theme),
    defaultTheme: themeManager.DEFAULT_THEME,
  },
});
