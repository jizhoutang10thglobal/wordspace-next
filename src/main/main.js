const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const { htmlPathFromArgv } = require('../lib/path-url');

// e2e 测试用：隔离 userData，避免污染真实的最近文档与历史
if (process.env.WS2_USERDATA) app.setPath('userData', process.env.WS2_USERDATA);

let win = null;
let pendingOpenPath = null;
let isDirty = false;
let forceClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      win.webContents.send('open-file', pendingOpenPath);
      pendingOpenPath = null;
    }
  });
  // 渲染层 beforeunload 在 Electron 里是静默拦截，提示必须由主进程弹
  win.on('close', (e) => {
    if (!isDirty || forceClose) return;
    e.preventDefault();
    if (process.env.WS2_NO_CLOSE_DIALOG) return;
    dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['取消', '放弃修改并关闭'],
      defaultId: 0,
      cancelId: 0,
      message: '文档有未保存的修改',
      detail: '关闭后未保存的修改将丢失。'
    }).then((r) => {
      if (r.response === 1) {
        forceClose = true;
        win.close();
      }
    });
  });
}

function sendMenu(cmd) {
  if (win) win.webContents.send('menu', cmd);
}

function buildMenu() {
  // 撤销/重做不用系统 role：必须走编辑器自己的统一撤销栈
  const template = [
    { label: 'Wordspace Next', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    {
      label: '文件',
      submenu: [
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenu('redo') },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    { role: 'windowMenu', label: '窗口' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 自动更新：仅打包后生效。dev 无 update feed，惰性 require（dev 不加载 electron-updater）。
// update-downloaded 后显式弹窗问用户（立即重启走 quitAndInstall / 稍后退出时自动装）。
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  const { buildUpdateDialogOptions, shouldInstall } = require('../lib/update-prompt');
  autoUpdater.on('error', (err) => console.error('[updater] error:', err && err.message));
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(buildUpdateDialogOptions(info && info.version)).then(({ response }) => {
      if (shouldInstall(response)) autoUpdater.quitAndInstall();
    }).catch((err) => console.error('[updater] dialog/install error:', err && err.message));
  });
  autoUpdater.checkForUpdates().catch(() => {});
}

// 把外部请求打开的文件路径送进窗口：已就绪则发并聚焦，未就绪则挂起等 did-finish-load。
function openExternalPath(p) {
  if (!p) return;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('open-file', p);
  } else {
    pendingOpenPath = p;
  }
}

// 把已运行实例的窗口带到前台（second-instance 无论带不带文件都该聚焦，这是单实例 app 的标准行为）。
function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

// macOS：Finder 双击 / 拖到 Dock（可能在 whenReady 之前触发，故走 pendingOpenPath 兜底）。
app.on('open-file', (e, p) => {
  e.preventDefault();
  openExternalPath(p);
});

ipcMain.on('set-dirty', (_e, v) => { isDirty = !!v; });

// 单实例：第二次启动（如再双击一个文件）不另起进程，而是把 argv 里的路径交给已运行实例并聚焦窗口。
// 这也是 Windows 文件关联能用的关键——否则双击只会无脑再开一个空窗口。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // workingDirectory（第三参）是「第二次启动」的 cwd，用它解析相对路径才对（不能用本实例的 cwd）。
  app.on('second-instance', (_e, argv, workingDirectory) => {
    focusWindow(); // 无文件也要把窗口带到前台
    const p = htmlPathFromArgv(argv, workingDirectory);
    if (p) openExternalPath(p);
  });

  app.whenReady().then(() => {
    registerIpc();
    buildMenu();
    createWindow();
    setupAutoUpdater();
    // Windows/Linux 首次带文件启动：从 argv 取路径（macOS 由上面的 open-file 事件负责）。
    // 此时 renderer 尚未 ready，挂 pendingOpenPath 等 did-finish-load 发出。
    if (process.platform !== 'darwin') {
      const p = htmlPathFromArgv(process.argv);
      if (p) pendingOpenPath = p;
    }
  });
  app.on('window-all-closed', () => app.quit());
}
