const { contextBridge, ipcRenderer } = require('electron');
const themeManager = require('../lib/theme-manager');
const viewMode = require('../lib/view-mode');

contextBridge.exposeInMainWorld('api', {
  getDocContent: () => ipcRenderer.invoke('get-doc-content'),
  theme: {
    DEFAULT_THEME: themeManager.DEFAULT_THEME,
    toggleTheme: themeManager.toggleTheme,
    getShellClass: themeManager.getShellClass,
    getDocStyle: themeManager.getDocStyle,
  },
  view: {
    DEFAULT_VIEW: viewMode.DEFAULT_VIEW,
    toggleView: viewMode.toggleView,
    getDisplayMode: viewMode.getDisplayMode,
  },
});
