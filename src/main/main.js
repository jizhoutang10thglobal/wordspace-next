const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const appearanceStore = require('./appearance-store');
const docWatcher = require('./doc-watcher');
const webTabs = require('./web-tabs');
const { htmlPathFromArgv } = require('../lib/path-url');
const webPolicy = require('../lib/web-tabs-policy');

// e2e 测试用：隔离 userData，避免污染真实的最近文档与历史。
// 修 MP-8：加 !app.isPackaged 闸（对齐 WS2_PDF_OUT 等全部 seam 惯例，这条原来漏了）——
// 生产包若继承到该环境变量会把 recents/history/workspace/标签全重定向，用户状态凭空消失。
if (process.env.WS2_USERDATA && !app.isPackaged) app.setPath('userData', process.env.WS2_USERDATA);

let win = null;
let rendererReady = false; // 修 MP-5：renderer 脚本是否已就绪（did-finish-load）；未就绪时 open-file 必须排队，不能直接 send
let pendingOpenPaths = []; // 修 MP-5：改成队列——mac 冷启动一次多选双击 N 个文件时单槽会只留最后一个
let pendingOpenUrls = []; // 默认浏览器：系统 open-url 可能在 renderer 就绪前到（冷启动点链接），同款排队
let isDirty = false;
let forceClose = false;
let quitting = false; // 真退出（Cmd+Q / 自动更新重启）标志：区分「关窗=隐藏驻留」与「退出=真销毁」

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 720,   // 缩不到比这更小：正文列 + 顶栏（文件名/保存按钮）放得开，避开 Bug3 那种拥挤；720=常见 1440 屏的一半，能并排分屏
    minHeight: 520,  // 顶栏 + 一屏可编辑内容的下限
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true // 启用 Chromium 内置 PDF 查看器（非 html 文件在编辑区直接预览 PDF）
    }
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  webTabs.init(() => win); // 网页标签 view 管理器（浏览器 feature）：attach/事件都以这个窗口为宿主
  if (!app.isPackaged) global.__ws2WebTabs = webTabs; // e2e seam：app.evaluate 沙箱无 require,经 global 取 registry（照 WS2_CTXMENU_PROBE 惯例,打包态不暴露）
  win.on('closed', () => { docWatcher.close(); webTabs.destroyAll(); }); // 关窗即停文件监听 + 销毁全部 web view（防 webContents 泄漏）
  // 修 MP-5：did-finish-load（主框架加载完成）后置就绪并 flush 排队的 open-file。
  // ⚠ 不用 did-start-loading 重置——它对 iframe（文档 frame）导航也触发，会把每次开文档都误判成 renderer 未就绪、
  // 而 did-finish-load 只认主框架、不会再触发 → rendererReady 永久卡 false（residency 唤醒开文档就废）。
  // 真正需要重置的只有主窗口重载（render-process-gone 里的 win.reload()），那处显式置 false。
  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    const q = pendingOpenPaths; pendingOpenPaths = [];
    for (const p of q) win.webContents.send('open-file', p);
    const uq = pendingOpenUrls; pendingOpenUrls = [];
    for (const u of uq) win.webContents.send('web-open-request', { url: u, background: false });
  });
  // 修 MP-15：renderer 崩溃（OOM/GPU 挂）原来无处理 = 白屏死窗，未保存临时文档（只活在 renderer 内存）全丢、
  // 唯一出路强退。这里提示并重载，至少把窗口救回来（磁盘文件不受影响）。
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details && details.reason === 'clean-exit') return;
    if (!win || win.isDestroyed()) return;
    dialog.showMessageBox(win, {
      type: 'error', buttons: ['重新加载'], defaultId: 0,
      message: '编辑器意外崩溃', detail: '未保存到磁盘的临时内容可能已丢失。已保存的文件不受影响。'
    }).then(() => { if (win && !win.isDestroyed()) { rendererReady = false; win.reload(); } }).catch(() => {});
  });
  // 渲染层 beforeunload 在 Electron 里是静默拦截，提示必须由主进程弹
  win.on('close', (e) => {
    if (forceClose) return;
    // macOS 关窗=隐藏驻留（Wendi 2026-07-03「关掉前台、后台开着」）：红叉 / Cmd+W 空态都走这——
    // 窗口藏起来、进程留在 Dock，点 Dock / 双击文件秒恢复（标签/未保存临时文档/滚动位置全保留）。
    // 只有真退出（Cmd+Q → before-quit 先行、自动更新 quitAndInstall 同）才继续往下销毁 + 未保存守卫。
    // Windows/Linux 不驻留：按平台惯例关窗即退（走下面守卫 → window-all-closed → quit）。
    if (process.platform === 'darwin' && !quitting) {
      e.preventDefault();
      webTabs.setAllAudioMuted(true); // 隐藏驻留：后台网页别继续放声/烧 CPU（P2-11；标签静音已砍,只能整体静音）
      win.hide();
      return;
    }
    if (!isDirty) return;
    e.preventDefault();
    quitting = false; // 这次退出被守卫拦下了：复位，用户取消后下次红叉仍是隐藏驻留、不是误销毁
    // seam 加 isPackaged 闸（对齐 WS2_PDF_OUT 等全部 seam 惯例）：生产进程继承到该变量不能静默跳过脏守卫
    if (!app.isPackaged && process.env.WS2_NO_CLOSE_DIALOG) return;
    // 审计 P1：隐藏驻留中 Cmd+Q——守卫对话框是挂在窗口上的 sheet，窗口 hidden 则 sheet 隐形、
    // 退出「按了没反应」且怎么都退不掉。弹框前先把窗口带回来。
    if (!win.isVisible()) win.show();
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
  if (!win || win.isDestroyed()) return; // 修 MP-9：补 isDestroyed 守卫（退出竞态期点菜单会 throw）
  // 修 MP-9：mac 隐藏驻留中菜单栏仍可点，但窗口 hidden → Cmd+O 选完文件在隐形窗口打开、Cmd+T 隐形建标签，
  // 用户感知「没反应」。发命令前先把窗口带回前台（这些命令都作用于窗口，show 是正确的）。
  focusWindow();
  win.webContents.send('menu', cmd);
}

// Bug 报告表单（Notion 公开表单）。应用菜单「Wordspace Next → 报告问题 / 反馈…」点开，用系统浏览器打开。
// 这是 Notion「Share form」的公开链接（notion.site）：测试员无需账号即可提交，且只看到表单、
// 看不到其他人的报告。别换成数据库页链接（那会暴露所有人的 bug）。
const BUG_REPORT_URL = 'https://humble-blanket-79b.notion.site/11f77f0ceeb647f899bcbe2798963b42?pvs=105';

// 外观三态的唯一枢纽：偏好持久化 + nativeTheme.themeSource（驱动 renderer prefers-color-scheme /
// mac 窗框 / 系统菜单 / 网页标签）+ 重建菜单勾选态 + 广播 renderer（⋯菜单/settings 同步 + 切换过渡）。
// 三入口（菜单栏 radio / ⋯菜单子菜单 / settings 面）都调这一个，状态永远一致。
function applyAppearance(pref) {
  const p = appearanceStore.setPref(pref);
  nativeTheme.themeSource = p; // 'system' | 'light' | 'dark'
  buildMenu(); // 重建以更新「外观」radio 勾选
  if (win && !win.isDestroyed()) win.webContents.send('appearance-changed', p);
  return p;
}

function buildMenu() {
  const appearancePref = appearanceStore.getPref();
  const appearanceItem = (label, value) => ({
    label, type: 'radio', checked: appearancePref === value, click: () => applyAppearance(value),
  });
  // 撤销/重做不用系统 role：必须走编辑器自己的统一撤销栈
  const template = [
    { label: 'Wordspace Next', submenu: [{ role: 'about' }, { label: '检查更新…', click: () => manualCheckForUpdates() }, { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('open-settings') }, { label: '报告问题 / 反馈…', click: () => shell.openExternal(BUG_REPORT_URL) }, { label: 'AI 接入…', click: () => sendMenu('ai-access') }, { type: 'separator' }, { label: '外观', submenu: [appearanceItem('跟随系统', 'system'), appearanceItem('浅色', 'light'), appearanceItem('深色', 'dark')] }, { label: '性能诊断…', click: () => sendMenu('perf-diag') }, { type: 'separator' }, { role: 'quit', label: '退出', accelerator: 'CmdOrCtrl+Q' }] },
    {
      label: '文件',
      submenu: [
        { label: '新建标签页', accelerator: 'CmdOrCtrl+T', click: () => sendMenu('new-tab') },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenu('open-folder') },
        { label: '快速打开…', accelerator: 'CmdOrCtrl+P', click: () => sendMenu('find-palette') },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: () => sendMenu('close-tab') },
        // 浏览器 feature（spec §4.4/§7）：⌘⇧T 重开最近关闭的标签（只记非文档标签,栈容量 15,renderer 管）
        { label: '重新打开关闭的标签页', accelerator: 'CmdOrCtrl+Shift+T', click: () => sendMenu('reopen-tab') },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { type: 'separator' },
        { label: '导出 PDF…', accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export-pdf') }
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
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        // Cmd+F = 文档内查找（调研裁决：全软件铁律）。shell 判定：块编辑器活跃→查找条，否则回退聚焦文件筛选。
        { label: '在文档中查找…', accelerator: 'CmdOrCtrl+F', click: () => sendMenu('find-in-doc') },
        // Cmd+Shift+F = 按文件名筛选（Cmd+F 让位后下沉到这，抄 VS Code 分层）。复用既有 find-file → focusFilter。
        { label: '在文件名中查找…', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendMenu('find-file') }
      ]
    },
    { role: 'windowMenu', label: '窗口' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 自动更新（重做：dialog 链 → 应用内面板）。状态机/展示模型在 src/lib/update-status.js（纯逻辑，单测在那层兜），
// 这里只做三件事：① electron-updater 事件 → 状态机 → 整包 {status,panel,pill} 推给 renderer（并缓存，
// renderer 启动后补拉——同 loadTabs 竞态的解法）；② 按状态机判定执行动作（shouldStartDownload → downloadUpdate）；
// ③ updater 文件日志落 userData/logs/updater.log（下次「更新没更上」有账可查）。
// 旧实现的 manualCheck/manualDownloading 双标志没了——manual 进状态机继承，MP-7 那类漏对齐不会再犯。
const US = require('../lib/update-status');
let autoUpdater = null;
let updStatus = null; // 最新状态（真相源在 main；renderer 只是显示）
let updLog = null;

function updatePayload() {
  return { status: updStatus, panel: US.panelModel(updStatus, app.getVersion()), pill: US.pillModel(updStatus) };
}

function pushUpdateEvent(evt) {
  const prev = updStatus;
  updStatus = US.nextStatus(prev, evt);
  if (updLog && evt.type !== 'progress') {
    updLog.info('evt=' + evt.type, (prev ? prev.state : '∅') + ' -> ' + updStatus.state,
      evt.version || '', evt.message || '');
  }
  if (win && !win.isDestroyed()) win.webContents.send('update-status', updatePayload());
  if (US.shouldStartDownload(prev, updStatus) && autoUpdater) {
    autoUpdater.downloadUpdate().catch((e) => pushUpdateEvent({ type: 'error', message: e && e.message }));
  }
}

function setupAutoUpdater() {
  // IPC 桥 dev/packaged 都建：dev 要能弹「开发模式」面板，e2e 靠 __ws2UpdateSim 驱动整条 UI 链。
  ipcMain.handle('update-get-status', () => updatePayload());
  ipcMain.handle('update-check', () => { manualCheckForUpdates(); });
  ipcMain.handle('update-download', () => {
    if (!app.isPackaged) { if (global.__ws2UpdateSim) global.__ws2UpdateSim.calls.download++; return; }
    pushUpdateEvent({ type: 'download-started' }); // shouldStartDownload 判真 → 真正开下载
  });
  ipcMain.handle('update-install', () => {
    if (!app.isPackaged) { if (global.__ws2UpdateSim) global.__ws2UpdateSim.calls.install++; return; }
    if (autoUpdater) { if (updLog) updLog.info('user chose quitAndInstall'); autoUpdater.quitAndInstall(); }
  });

  if (!app.isPackaged) {
    // e2e seam（照 __ws2WebTabs 惯例，仅非打包态）：注入状态事件驱动面板/pill，动作调用只计数不真跑。
    global.__ws2UpdateSim = { push: (evt) => pushUpdateEvent(evt), calls: { download: 0, install: 0 }, payload: () => updatePayload() };
    return;
  }

  updLog = require('../lib/file-log').createFileLogger(path.join(app.getPath('userData'), 'logs', 'updater.log'));
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.logger = updLog; // electron-updater 自身的下载/差分/安装日志也进同一个文件
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => pushUpdateEvent({
    type: 'available',
    version: info && info.version,
    notes: US.parseReleaseNotes(info && info.releaseNotes), // GitHub release body 顶部的人话说明（docs/releasing.md 约定）
  }));
  autoUpdater.on('update-not-available', () => pushUpdateEvent({ type: 'not-available' }));
  autoUpdater.on('download-progress', (p) => pushUpdateEvent({
    type: 'progress', percent: p && p.percent, transferred: p && p.transferred, total: p && p.total, bytesPerSecond: p && p.bytesPerSecond,
  }));
  autoUpdater.on('update-downloaded', (info) => pushUpdateEvent({ type: 'downloaded', version: info && info.version }));
  autoUpdater.on('error', (err) => pushUpdateEvent({ type: 'error', message: err && err.message }));

  // 启动自动查一次（auto 路径：manual=false → 有更新静默下载，renderer 只挂 pill 不弹面板）。
  pushUpdateEvent({ type: 'checking', manual: false });
  autoUpdater.checkForUpdates().catch((e) => pushUpdateEvent({ type: 'error', message: e && e.message }));
}

// 菜单「检查更新…」：手动查（manual=true → renderer 弹面板跟进全程）。
// 已在下载/已就绪时不重查——把当前状态标成 manual 重推，面板直接打开显示进行中的下载/重启按钮。
function manualCheckForUpdates() {
  if (!app.isPackaged || !autoUpdater) { pushUpdateEvent({ type: 'dev-check' }); return; }
  if (updStatus && (updStatus.state === 'downloading' || updStatus.state === 'ready')) {
    updStatus = { ...updStatus, manual: true };
    if (win && !win.isDestroyed()) win.webContents.send('update-status', updatePayload());
    return;
  }
  pushUpdateEvent({ type: 'checking', manual: true });
  autoUpdater.checkForUpdates().catch((e) => pushUpdateEvent({ type: 'error', message: e && e.message }));
}

// 把外部请求打开的文件路径送进窗口：已就绪则发并聚焦，未就绪则挂起等 did-finish-load。
function openExternalPath(p) {
  if (!p) return;
  // 修 MP-5：只有窗口在且 renderer 已就绪才直接 send；否则排队等 did-finish-load（防冷启动慢时 send 给
  // 还没跑 shell.js 的页面 → 消息无人接收静默丢、文件不打开）。
  if (win && !win.isDestroyed() && rendererReady) {
    focusWindow();
    win.webContents.send('open-file', p);
  } else {
    if (win && !win.isDestroyed()) focusWindow();
    pendingOpenPaths.push(p);
  }
}

// 把已运行实例的窗口带到前台（second-instance 无论带不带文件都该聚焦，这是单实例 app 的标准行为）。
// 隐藏驻留中（macOS 关窗后）被唤起也走这：先 show 再 focus——hidden 窗口只 focus 不会显形。
function focusWindow() {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
  webTabs.setAllAudioMuted(false); // 唤回前台：解除隐藏驻留时的静音（P2-11；幂等,每次唤起都调无妨）
}

// macOS：Finder 双击 / 拖到 Dock（可能在 whenReady 之前触发，故走 pendingOpenPath 兜底）。
app.on('open-file', (e, p) => {
  e.preventDefault();
  openExternalPath(p);
});

// macOS：系统递来的 http/https 链接（设为默认浏览器后点任何链接都走这；也可能在 whenReady 前到）。
// scheme 白名单复用 web-tabs-policy——file:/javascript: 等系统理论上不会发，但零信任直接丢弃。
// 复用 web-open-request 通道：renderer 侧 browser.js 已有消费者（建网页标签 + 激活）。
function openExternalUrlFromOS(u) {
  if (!webPolicy.isAllowedNavUrl(u)) return;
  if (win && !win.isDestroyed() && rendererReady) {
    focusWindow();
    win.webContents.send('web-open-request', { url: u, background: false });
  } else {
    if (win && !win.isDestroyed()) focusWindow();
    pendingOpenUrls.push(u);
  }
}
app.on('open-url', (e, u) => {
  e.preventDefault();
  openExternalUrlFromOS(u);
});

ipcMain.on('set-dirty', (_e, v) => { isDirty = !!v; });
// renderer 的 Cmd+W 空态「关窗口」入口：统一走 win.close()，由上面 close 守卫按平台分流
// （macOS=隐藏驻留 / 其他平台=真关 → 退出），别在 renderer 里自己 hide 绕开语义收口。
ipcMain.on('win-close', () => { if (win && !win.isDestroyed()) win.close(); });

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
    // 外观:启动读偏好 → 设 nativeTheme.themeSource(在 buildMenu/createWindow 前,让首个窗口首帧就对)。
    appearanceStore.init(app.getPath('userData'));
    nativeTheme.themeSource = appearanceStore.getPref();
    ipcMain.handle('get-appearance', () => appearanceStore.getPref());
    ipcMain.on('set-appearance', (_e, pref) => applyAppearance(pref));
    registerIpc();
    buildMenu();
    createWindow();
    setupAutoUpdater();
    require('./link-index').warm(); // U6：预热索引解析器（避开首次开文档冷 import 的竞态 + 加速首次反链）
    // Windows/Linux 首次带文件启动：从 argv 取路径（macOS 由上面的 open-file 事件负责）。
    // 此时 renderer 尚未 ready，挂 pendingOpenPath 等 did-finish-load 发出。
    if (process.platform !== 'darwin') {
      const p = htmlPathFromArgv(process.argv);
      if (p) pendingOpenPaths.push(p);
    }
    // 测试 seam（仅非打包态，仿 WS2_FOLDER_IN）：挂 pendingOpenPaths 忠实复现 macOS 冷启动
    // 「Finder 双击」那条路（open-file 在 ready 前到、等 did-finish-load 才发），e2e 点不了真 Finder。
    if (!app.isPackaged && process.env.WS2_OPEN_FILE) pendingOpenPaths.push(process.env.WS2_OPEN_FILE);
    // 同款 seam：冷启动系统递 URL（open-url 在 ready 前到）。走 openExternalUrlFromOS 而不是直接
    // push 队列——让 seam 也过 scheme 白名单，e2e 才能验「file:// 不开标签」这道门。
    if (!app.isPackaged && process.env.WS2_OPEN_URL) openExternalUrlFromOS(process.env.WS2_OPEN_URL);
  });
  // 真退出的第一信号（Cmd+Q / autoUpdater.quitAndInstall 内部 quit 都会先发 before-quit）：
  // 打上标志，close 守卫据此放行销毁而不是隐藏。
  app.on('before-quit', () => { quitting = true; });
  // macOS：隐藏驻留中点 Dock 图标 → 把窗口带回来（标准 mac 行为）。
  app.on('activate', () => focusWindow());
  app.on('window-all-closed', () => app.quit());
}
