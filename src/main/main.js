const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const appearanceStore = require('./appearance-store');
const docWatcher = require('./doc-watcher');
const webTabs = require('./web-tabs');
const { htmlPathFromArgv } = require('../lib/path-url');
const webPolicy = require('../lib/web-tabs-policy');
const i18n = require('../lib/i18n');
const { ZH, EN } = require('../i18n');
const languageStore = require('./language-store');

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
    // 沉浸窗框（Arc 对标，Wendi 2026-07-16，spec=docs/features/immersive-collapse.md）：
    // macOS 去系统标题栏，红绿灯叠进侧栏头（.sb-head 40px 行，y=14 让 12px 灯垂直居中）；
    // 拖拽区改走 .sb-head 的 -webkit-app-region。Windows/Linux 保持标准窗框（记 spec 欠账）。
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 }
    } : {}),
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
      type: 'error', buttons: [i18n.t('dialog.reloadBtn')], defaultId: 0,
      message: i18n.t('dialog.crashMessage'), detail: i18n.t('dialog.crashDetail')
    }).then(() => { if (win && !win.isDestroyed()) { rendererReady = false; win.reload(); } }).catch(() => {});
  });
  // 渲染层 beforeunload 在 Electron 里是静默拦截，提示必须由主进程弹
  win.on('close', (e) => {
    if (forceClose) return;
    // macOS 关窗=隐藏驻留（Wendi 2026-07-03「关掉前台、后台开着」）：红叉 / Cmd+W 空态都走这——
    // 窗口藏起来、进程留在 Dock，点 Dock / 双击文件秒恢复（标签/未保存临时文档/滚动位置全保留）。
    // 只有真退出（Cmd+Q → before-quit 先行；自动更新 quitAndInstall → before-quit-for-update 先行）
    // 才继续往下销毁 + 未保存守卫。
    // Windows/Linux 不驻留：按平台惯例关窗即退（走下面守卫 → window-all-closed → quit）。
    // WS2_DARWIN_PERSIST_SIM（isPackaged 闸,seam 惯例）：非 mac 的 CI 上强制走这条驻留分支——
    // 「更新退出被驻留守卫吞掉」的 e2e 门要在 Linux CI 也有牙（bug 本体是 darwin-only 的）。
    const darwinPersist = process.platform === 'darwin' || (!app.isPackaged && process.env.WS2_DARWIN_PERSIST_SIM);
    if (darwinPersist && !quitting) {
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
      buttons: [i18n.t('common.cancel'), i18n.t('dialog.discardClose')],
      defaultId: 0,
      cancelId: 0,
      message: i18n.t('dialog.unsavedMessage'),
      detail: i18n.t('dialog.unsavedDetail')
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

// 更新日志页（正本=仓库根 CHANGELOG.md,官网构建时渲染）。菜单/更新面板入口都开成 app 内网页标签
// （吃自己浏览器的狗粮）,不跳系统浏览器。
const CHANGELOG_URL = 'https://wordspace.ai/changelog';

// 外观三态的唯一枢纽：偏好持久化 + nativeTheme.themeSource（驱动 mac 窗框/系统菜单/对话框/网页标签，
// R3/R6）+ 重建菜单勾选态 + 广播 renderer（chrome data-theme + ⋯菜单/settings 同步 + 切换过渡）。
// ⚠ renderer chrome 走 data-theme 属性而非 prefers-color-scheme：Electron 里 themeSource 改变不 live 更新
// 已加载 renderer 的 prefers-color-scheme（实测），故广播 effective 主题让 renderer 自己挂 data-theme。
// 三入口（菜单栏 radio / ⋯菜单子菜单 / settings 面）都调这一个，状态永远一致。
function effectiveTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}
function broadcastAppearance(pref) {
  if (win && !win.isDestroyed()) win.webContents.send('appearance-changed', { pref, effective: effectiveTheme() });
}
function applyAppearance(pref) {
  const p = appearanceStore.setPref(pref);
  nativeTheme.themeSource = p; // 'system' | 'light' | 'dark'
  buildMenu(); // 重建以更新「外观」radio 勾选
  broadcastAppearance(p);
  return p;
}

// 语言三态枢纽（照 appearance 先例；关键差异：系统语言无 nativeTheme.on('updated') 那样的 live 事件，
// app.getLocale() 只在启动读一次，故「跟随系统」改系统语言要重启 app 才生效——不建对应监听）。
// WS2_LANG seam（仅非打包态，照 WS2_USERDATA 等惯例的 !app.isPackaged 闸）：强制偏好，优先于持久化与
// app.getLocale()，给 e2e 锁定语言用（生产包继承到该变量不会劫持用户语言）。
function langPref() {
  if (!app.isPackaged && process.env.WS2_LANG) return i18n.normalizeLangPref(process.env.WS2_LANG);
  return languageStore.getPref();
}
function effectiveLangNow() {
  return i18n.effectiveLang(langPref(), app.getLocale());
}
// 把当前生效语言解析成一张扁平字典(en 缺 key fallback zh)发给 preload。
// 主窗口 preload 是 sandboxed(默认 sandbox:true，不设 sandbox:false)——**不能 require 项目模块**，
// 故字典在主进程(Node 上下文，require 无碍)解析好、经 sendSync 送过去，preload 只做查表 + 参数替换。
// 语言切换走整窗 reload，本页生命周期内字典固定。
function resolvedDict() {
  const lang = effectiveLangNow();
  const out = {};
  for (const k in ZH) out[k] = ZH[k];
  if (lang === 'en') for (const k in EN) if (EN[k] != null) out[k] = EN[k];
  return out;
}
function broadcastLanguage() {
  if (win && !win.isDestroyed()) win.webContents.send('language-changed', { pref: langPref(), lang: effectiveLangNow() });
}
// 用户切语言：持久化 + 更新 imperative t 当前语言 + 重建菜单（label 随语言变，U3 起）+ 广播 renderer。
// renderer 侧收到广播后弹「重新加载以应用语言」——静态外壳(index.html/工具条)建一次不重建，整窗 reload 最省（见 plan 决策1）。
function applyLanguage(pref) {
  const p = languageStore.setPref(pref);
  i18n.setActiveLang(effectiveLangNow());
  buildMenu();
  broadcastLanguage();
  return p;
}

function buildMenu() {
  const t = i18n.t; // 读 setActiveLang 设的当前语言；applyLanguage 里先 setActiveLang 再 buildMenu，切语言即重建
  const appearancePref = appearanceStore.getPref();
  const appearanceItem = (label, value) => ({
    label, type: 'radio', checked: appearancePref === value, click: () => applyAppearance(value),
  });
  // 撤销/重做不用系统 role：必须走编辑器自己的统一撤销栈
  const template = [
    { label: 'Wordspace Next', submenu: [{ role: 'about' }, { label: t('menu.checkUpdates'), click: () => manualCheckForUpdates() }, { label: t('menu.changelog'), click: () => openExternalUrlFromOS(CHANGELOG_URL) }, { label: t('menu.settings'), accelerator: 'CmdOrCtrl+,', click: () => sendMenu('open-settings') }, { label: t('menu.reportIssue'), click: () => shell.openExternal(BUG_REPORT_URL) }, { label: t('menu.aiAccess'), click: () => sendMenu('ai-access') }, { type: 'separator' }, { label: t('menu.appearance'), submenu: [appearanceItem(t('common.apprSystem'), 'system'), appearanceItem(t('common.apprLight'), 'light'), appearanceItem(t('common.apprDark'), 'dark')] }, { label: t('menu.perfDiag'), click: () => sendMenu('perf-diag') }, { type: 'separator' }, { role: 'quit', label: t('common.quit'), accelerator: 'CmdOrCtrl+Q' }] },
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newTab'), accelerator: 'CmdOrCtrl+T', click: () => sendMenu('new-tab') },
        { label: t('menu.openFile'), accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: t('menu.openFolder'), accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenu('open-folder') },
        // 逃生门（诊断 D4）：不依赖侧栏树/根行渲染的「管理/移除文件夹」入口——大根死门时也能移除坏根。
        { label: t('menu.manageRoots'), click: () => sendMenu('manage-roots') },
        { label: t('menu.quickOpen'), accelerator: 'CmdOrCtrl+P', click: () => sendMenu('find-palette') },
        { label: t('menu.closeTab'), accelerator: 'CmdOrCtrl+W', click: () => sendMenu('close-tab') },
        // 浏览器 feature（spec §4.4/§7）：⌘⇧T 重开最近关闭的标签（只记非文档标签,栈容量 15,renderer 管）
        { label: t('menu.reopenTab'), accelerator: 'CmdOrCtrl+Shift+T', click: () => sendMenu('reopen-tab') },
        { label: t('common.save'), accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { type: 'separator' },
        { label: t('menu.exportPdf'), accelerator: 'CmdOrCtrl+E', click: () => sendMenu('export-pdf') }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('common.undo'), accelerator: 'CmdOrCtrl+Z', click: () => sendMenu('undo') },
        { label: t('common.redo'), accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenu('redo') },
        { type: 'separator' },
        { role: 'cut', label: t('common.cut') },
        { role: 'copy', label: t('common.copy') },
        { role: 'paste', label: t('common.paste') },
        // 全选去 role 化（王波 2026-07-17 分级全选）：role selectAll 的默认加速器会把 ⌘/Ctrl+A 吃在
        // 菜单层（U4 同款血教训），块编辑器的分级逻辑（一次选块、两次全篇，blockedit.js）永远收不到键。
        // 点击行为保持等价（focusedWebContents.selectAll，作用聚焦上下文：编辑器 iframe/omnibox/网页 view）。
        // mac 不设 accelerator（mac 忽略 registerAccelerator:false、设了必吃键→菜单项不显示 ⌘A，小代价）；
        // Win/Linux 用 registerAccelerator:false 保显示不注册。
        {
          label: t('common.selectAll'),
          ...(process.platform === 'darwin' ? {} : { accelerator: 'CmdOrCtrl+A', registerAccelerator: false }),
          click: () => { const f = require('electron').webContents.getFocusedWebContents(); if (f && !f.isDestroyed()) f.selectAll(); }
        },
        { type: 'separator' },
        // Cmd+F = 文档内查找（调研裁决：全软件铁律）。shell 判定：块编辑器活跃→查找条，否则回退聚焦文件筛选。
        { label: t('menu.findInDoc'), accelerator: 'CmdOrCtrl+F', click: () => sendMenu('find-in-doc') },
        // Cmd+Shift+F = 按文件名筛选（Cmd+F 让位后下沉到这，抄 VS Code 分层）。复用既有 find-file → focusFilter。
        { label: t('menu.findInFiles'), accelerator: 'CmdOrCtrl+Shift+F', click: () => sendMenu('find-file') }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        // ⌘\ 切换侧栏：菜单加速器覆盖一切焦点域（含文档编辑 iframe 内，keydown 不冒泡的失灵域）。renderer onMenu → toggleCollapsed。
        { label: t('menu.toggleSidebar'), accelerator: 'CmdOrCtrl+\\', click: () => sendMenu('toggle-sidebar') },
        // ⌘R 刷新当前网页标签（文档标签 no-op，防未保存编辑丢失）。自建菜单替换了默认 View>Reload，此处显式给回浏览器语义的刷新。
        { label: t('menu.reload'), accelerator: 'CmdOrCtrl+R', click: () => sendMenu('reload') }
      ]
    },
    { role: 'windowMenu', label: t('menu.window') }
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

// 用户点了「重启安装」→ **动作点直置 quitting=true 放行退出，零事件依赖**。
// ⚠ 为什么不能靠事件（二次血教训，Colin 2026-07-17 复现）：native Squirrel 的 quitAndInstall 逐窗
// close 前发的 'before-quit-for-update' 挂在 require('electron').autoUpdater（AutoUpdater 接口，
// electron.d.ts:1995）上——**不是 app 的事件**。2026-07-16 那版 app.on('before-quit-for-update')
// 是给不存在的事件挂监听、从未触发过：quitting 恒 false → darwin 驻留守卫把更新的关窗 preventDefault
// 吞掉 → 窗口只是 hide、Squirrel 永远等不到全关 →「点了重启,app 还赖在 Dock 里」。
function beginQuitForUpdate(fire) {
  quitting = true;
  try { fire(); } catch (e) {
    quitting = false; // 安装序列没启动成功：复位，别让下次红叉从「隐藏驻留」漂移成「真退出」
    if (updLog) updLog.error('quitAndInstall threw: ' + ((e && e.stack) || e));
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
  ipcMain.handle('update-install', async () => {
    if (!app.isPackaged) {
      if (global.__ws2UpdateSim) global.__ws2UpdateSim.calls.install++;
      // 退出链 e2e（WS2_UPDATE_QUIT_SIM，isPackaged 闸）：走与真路径**同一个** beginQuitForUpdate，
      // 用「逐窗 close」模拟 native quitAndInstall 的关窗序列（全关 → window-all-closed → app.quit()，
      // 与 Squirrel 时序同构）。门守的是「darwin 隐藏驻留守卫吞掉更新退出」这条链。
      if (process.env.WS2_UPDATE_QUIT_SIM) beginQuitForUpdate(() => { for (const w of BrowserWindow.getAllWindows()) w.close(); });
      return;
    }
    if (!autoUpdater) return;
    await maybeRepairBundleOwnership(); // 免密修复（一次性）：失败/跳过都不拦安装，最坏回到 ShipIt 提权老路径
    if (updLog) updLog.info('user chose quitAndInstall');
    beginQuitForUpdate(() => autoUpdater.quitAndInstall());
  });
  ipcMain.handle('update-open-changelog', () => {
    if (!app.isPackaged) { if (global.__ws2UpdateSim) global.__ws2UpdateSim.calls.changelog++; return; }
    openExternalUrlFromOS(CHANGELOG_URL); // 开成 app 内网页标签（含就绪排队与 scheme 白名单）
  });

  if (!app.isPackaged) {
    // e2e seam（照 __ws2WebTabs 惯例，仅非打包态）：注入状态事件驱动面板/pill，动作调用只计数不真跑。
    global.__ws2UpdateSim = { push: (evt) => pushUpdateEvent(evt), calls: { download: 0, install: 0, changelog: 0 }, payload: () => updatePayload() };
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

// 更新免密的一次性修复（仅 mac）。病根（2026-07-16 Colin 机器实锤）：bundle 被某次提权安装写成
// root:wheel 后，Squirrel ShipIt 每次替换都要管理员授权（密码/指纹），且提权装出的新 bundle 又是
// root 的 → 每次更新都要密码。这里在 quitAndInstall 前检测 bundle 可写性：不可写 → 解释 + 请求授权
// 一次，chown 回当前用户 → 此后 ShipIt 恢复无提权替换，更新免密。用户跳过/修复失败都不拦安装
// （落回 ShipIt 自己的提权弹窗，不比现状差）。全程记 updater.log。
async function maybeRepairBundleOwnership() {
  if (process.platform !== 'darwin') return;
  try {
    const fs = require('fs');
    const repair = require('../lib/mac-bundle-repair');
    const bundle = repair.bundlePathFromExe(app.getPath('exe'));
    if (!bundle) return;
    try {
      // bundle 根 + Contents 都可写才算健康（ShipIt 替换要动整棵树；root:wheel 755 下两者都不可写）
      await fs.promises.access(bundle, fs.constants.W_OK);
      await fs.promises.access(path.join(bundle, 'Contents'), fs.constants.W_OK);
      return;
    } catch {}
    if (updLog) updLog.warn('bundle not writable by current user, offering one-time ownership repair: ' + bundle);
    if (win && !win.isDestroyed() && !win.isVisible()) win.show(); // 隐藏驻留中弹 sheet 会隐形（同脏守卫的教训）
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: [i18n.t('dialog.repairAndInstall'), i18n.t('dialog.skipRepair')],
      defaultId: 0,
      cancelId: 1,
      message: i18n.t('dialog.repairTitle'),
      detail: i18n.t('dialog.repairDetail'),
    });
    if (r.response !== 0) { if (updLog) updLog.info('ownership repair skipped by user'); return; }
    await new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile('osascript', repair.buildRepairArgs(process.getuid(), bundle), { timeout: 120000 }, (err, _out, stderr) => {
        if (updLog) {
          if (err) updLog.warn('ownership repair failed: ' + ((stderr || '').trim() || err.message)); // 用户取消授权也走这
          else updLog.info('ownership repair succeeded: ' + bundle);
        }
        resolve(); // 成败都继续安装
      });
    });
  } catch (e) {
    if (updLog) updLog.warn('ownership repair error: ' + (e && e.message));
  }
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
    ipcMain.handle('get-effective-theme', () => effectiveTheme());
    ipcMain.on('set-appearance', (_e, pref) => applyAppearance(pref));
    // OS 主题变化（pref=system 时 shouldUseDarkColors 翻转）→ 重播 effective，让 renderer 实时跟随。
    nativeTheme.on('updated', () => broadcastAppearance(appearanceStore.getPref()));
    // 语言:启动读偏好 + 装字典 + 设 imperative t 当前语言(在 buildMenu/createWindow 前，让首个窗口首帧就对)。
    // 无「OS 语言变化」监听——app.getLocale 只启动读一次，跟随系统改语言要重启(平台限制,plan 决策1)。
    languageStore.init(app.getPath('userData'));
    i18n.configureI18n(ZH, EN);
    i18n.setActiveLang(effectiveLangNow());
    ipcMain.handle('get-language', () => langPref());
    ipcMain.handle('get-effective-lang', () => effectiveLangNow());
    // preload 在页面脚本跑之前就要建好 window.wsT(不能异步等)，故 sendSync 一次拿 { 生效语言, 解析好的扁平字典 }。
    ipcMain.on('get-i18n-boot-sync', (e) => { e.returnValue = { lang: effectiveLangNow(), dict: resolvedDict() }; });
    ipcMain.on('set-language', (_e, pref) => applyLanguage(pref));
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
  // 真退出的第一信号：打上标志，close 守卫据此放行销毁而不是隐藏。
  // Cmd+Q 走 before-quit；autoUpdater.quitAndInstall() **不走 before-quit**（它逐窗 close、全关后才 quit）。
  // ⚠ 血教训一（2026-07-16）：只接 before-quit → quitAndInstall 的关窗被 darwin 驻留守卫吞掉,点了重启没反应
  //   （updater.log 2026-07-15 四连击实锤）。
  // ⚠ 血教训二（2026-07-17 Colin 复现）：上一版补的 app.on('before-quit-for-update') 也是哑的——该事件挂在
  //   require('electron').autoUpdater（AutoUpdater 接口，electron.d.ts:1995）上，**不是 app 事件**，从未触发。
  //   主修已改为动作点直置（update-install handler → beginQuitForUpdate，零事件依赖）；下面在**正确的发射器**
  //   上再挂一份兜底（防未来其他路径触发 native quitAndInstall，如 autoInstallOnAppQuit）。
  app.on('before-quit', () => { quitting = true; });
  try { require('electron').autoUpdater.on('before-quit-for-update', () => { quitting = true; }); } catch { /* 平台无 native autoUpdater：安静跳过 */ }
  // macOS：隐藏驻留中点 Dock 图标 → 把窗口带回来（标准 mac 行为）。
  app.on('activate', () => focusWindow());
  app.on('window-all-closed', () => app.quit());
}
