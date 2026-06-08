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

  // 自动更新：只在打包后的 app 生效。dev 模式没有 update feed，且会报错，故 isPackaged 守卫 +
  // 惰性 require（dev 根本不加载 electron-updater）。feed 地址由 electron-builder 从
  // build.publish 烤进 app-update.yml，这里不用再配。
  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    // 网络/feed 失败时别让未捕获的 promise 拒绝崩主进程（Electron 33 默认 unhandled-rejections=throw）
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('[updater] check failed:', err && err.message);
    });
  }

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
