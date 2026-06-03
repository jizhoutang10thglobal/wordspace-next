const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { getWindowConfig } = require('./lib/window-config');
const { loadBuiltinDocument } = require('./lib/doc-loader');

ipcMain.handle('get-doc-content', async () => {
  return loadBuiltinDocument();
});

function createWindow() {
  const config = getWindowConfig();
  const win = new BrowserWindow(config);
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
