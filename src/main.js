const { app, BrowserWindow, dialog, ipcMain } = require('electron');
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
    // 单个 'error' 监听同时覆盖 check 和 download 两个阶段的失败，比只 .catch check-promise 全
    // （download 阶段失败走内部 promise、catch 接不到）。Electron 33 默认 unhandled-rejections=throw，
    // 没这个监听网络/feed 失败会崩主进程。
    autoUpdater.on('error', (err) => {
      console.error('[updater] error:', err && err.message);
    });
    // S5 显式更新弹窗：下载完成后问用户。「立即重启」马上 quitAndInstall；「稍后」沿用
    // electron-updater 默认的退出时自动安装。弹什么/怎么判在纯模块 update-prompt（vitest 单测）。
    const { buildUpdateDialogOptions, shouldInstall } = require('./lib/update-prompt');
    autoUpdater.on('update-downloaded', (info) => {
      dialog.showMessageBox(buildUpdateDialogOptions(info && info.version)).then(({ response }) => {
        if (shouldInstall(response)) {
          autoUpdater.quitAndInstall();
        }
      }).catch((err) => {
        // quitAndInstall 在 .then 里同步抛会变成 rejection，Electron 33 没 catch 直接崩主进程
        console.error('[updater] dialog/install error:', err && err.message);
      });
    });
    // checkForUpdates 的 rejection 已由上面 'error' 监听上报；catch 只为防 Electron 33
    // unhandled-rejections=throw 崩主进程（同一失败两条路都会冒出来）。
    autoUpdater.checkForUpdates().catch(() => {});
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
