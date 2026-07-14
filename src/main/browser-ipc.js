// 浏览器 feature 的 IPC 面（spec §10.3）。原则：
//  - 历史写入无 renderer 入口（只由 web-tabs 导航事件驱动）；renderer 只有 removeOne/clear。
//  - 收藏/历史变更后推全量（数据小：收藏 + ≤500 历史），renderer 内存镜像供逐键补全（不跨 IPC）。
//  - 导入导出走主进程系统对话框 + fs（renderer 不传路径）。
const { ipcMain, dialog, app, BrowserWindow } = require('electron');
const fsp = require('fs/promises');
const path = require('path');
const webTabs = require('./web-tabs');
const browserStore = require('./browser-store');
const bookmarksLib = require('../lib/bookmarks');
const engines = require('../lib/search-engines');

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  }
}
function pushHistory(entries) { broadcast('history-changed', entries || browserStore.getHistory()); }

function registerBrowserIpc() {
  browserStore.init(app.getPath('userData'));
  webTabs.setHistoryHook((entries) => pushHistory(entries));
  // 收藏变更 → 全量推 renderer,走 store 的 leading-edge 防抖合并（P3-11：单次变更立即推,窗口内多次合并）。
  browserStore.subscribe('bookmarks', (data) => broadcast('bookmarks-changed', data));

  // ---- 网页标签 view 生命周期 / 导航（renderer 激活漏斗驱动）----
  ipcMain.handle('webtab-navigate', (_e, key, input) => webTabs.navigate(String(key), String(input == null ? '' : input)));
  ipcMain.handle('webtab-load-url', (_e, key, url) => webTabs.loadUrlDirect(String(key), String(url == null ? '' : url)));
  ipcMain.on('webtab-nav', (_e, key, action) => webTabs.nav(String(key), String(action)));
  ipcMain.on('webtab-show', (_e, key, bounds) => { webTabs.show(String(key), sanitizeBounds(bounds)); webTabs.wireFoundInPage(String(key)); });
  ipcMain.on('webtab-hide-all', () => webTabs.hideAll());
  ipcMain.on('webtab-bounds', (_e, key, bounds) => webTabs.setBounds(String(key), sanitizeBounds(bounds)));
  ipcMain.on('webtab-close', (_e, key) => webTabs.destroy(String(key)));
  ipcMain.on('webtab-find', (_e, key, text, opts) => webTabs.find(String(key), String(text == null ? '' : text), opts && typeof opts === 'object' ? { forward: opts.forward !== false, findNext: !!opts.findNext } : {}));
  ipcMain.on('webtab-find-stop', (_e, key, action) => webTabs.stopFind(String(key), action === 'keepSelection' ? 'keepSelection' : 'clearSelection'));
  ipcMain.on('webtab-zoom', (_e, key, dir) => webTabs.setZoom(String(key), dir === 'out' ? 'out' : dir === 'reset' ? 'reset' : 'in'));
  ipcMain.handle('webtab-export-pdf', (_e, key) => webTabs.printToPdf(String(key)));

  // ---- 收藏（spec §4.9；全部返回新全量并广播）----
  ipcMain.handle('bm-state', () => browserStore.getBookmarks());
  ipcMain.handle('bm-add', (_e, b) => {
    const src = b && typeof b === 'object' ? b : {};
    if (typeof src.url !== 'string' || !/^https?:\/\//i.test(src.url)) return null;
    if (bookmarksLib.isBookmarked(browserStore.getBookmarks(), src.url)) return null; // 同 url 已收藏 → 不重复加（连点 ⌘D 的服务端防御,#12）
    const r = bookmarksLib.add(browserStore.getBookmarks(), {
      title: typeof src.title === 'string' ? src.title : '',
      url: src.url,
      folderId: typeof src.folderId === 'string' ? src.folderId : undefined,
      favicon: typeof src.favicon === 'string' ? src.favicon : undefined,
      ts: Date.now(),
    });
    browserStore.setBookmarks(r.state); // 推送由 store.subscribe('bookmarks') 防抖合并驱动
    return r.id;
  });
  const mutate = (fn) => {
    const next = fn(browserStore.getBookmarks());
    browserStore.setBookmarks(next);
    return true;
  };
  ipcMain.handle('bm-remove-by-url', (_e, url) => mutate((s) => bookmarksLib.removeByUrl(s, String(url))));
  ipcMain.handle('bm-remove-one', (_e, id) => mutate((s) => bookmarksLib.removeOne(s, String(id))));
  ipcMain.handle('bm-update', (_e, id, patch) => mutate((s) => bookmarksLib.update(s, String(id), patch && typeof patch === 'object' ? patch : {})));
  ipcMain.handle('bm-add-folder', (_e, name) => {
    const r = bookmarksLib.addFolder(browserStore.getBookmarks(), typeof name === 'string' ? name : '', Date.now());
    browserStore.setBookmarks(r.state);
    return r.id;
  });
  ipcMain.handle('bm-rename-folder', (_e, id, name) => mutate((s) => bookmarksLib.renameFolder(s, String(id), typeof name === 'string' ? name : '')));
  ipcMain.handle('bm-remove-folder', (_e, id) => mutate((s) => bookmarksLib.removeFolder(s, String(id))));
  // 导出：系统保存框 → 写 Netscape HTML（WS2_BM_OUT 测试 seam,照 WS2_PDF_OUT 先例,仅非打包态）。
  ipcMain.handle('bm-export', async (e) => {
    const html = bookmarksLib.toNetscapeHtml(browserStore.getBookmarks());
    let out = !app.isPackaged ? process.env.WS2_BM_OUT : null;
    if (!out) {
      let defDir;
      try { defDir = app.getPath('downloads'); } catch { defDir = app.getPath('home'); }
      const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: '导出书签',
        defaultPath: path.join(defDir, 'bookmarks.html'),
        filters: [{ name: 'HTML 书签', extensions: ['html'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      out = r.filePath;
    }
    await fsp.writeFile(out, html, 'utf8');
    return { ok: true, path: out };
  });
  // 导入：系统打开框 → 宽容解析合并（重名后缀/同址去重在 lib）。WS2_BM_IN 测试 seam。
  ipcMain.handle('bm-import', async (e) => {
    let file = !app.isPackaged ? process.env.WS2_BM_IN : null;
    if (!file) {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
        title: '导入书签',
        filters: [{ name: 'HTML 书签', extensions: ['html', 'htm'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      file = r.filePaths[0];
    }
    let html;
    try { html = await fsp.readFile(file, 'utf8'); } catch (err) { return { error: String((err && err.message) || err) }; }
    const before = browserStore.getBookmarks();
    const r = bookmarksLib.importNetscape(before, html, Date.now());
    // 有净新增书签,或有新增文件夹（P3-10 温和修正后可能加空文件夹）→ 落盘 + 推（subscribe 驱动）
    if (r.added || r.state.folders.length !== before.folders.length) browserStore.setBookmarks(r.state);
    return { parsed: r.parsed, added: r.added };
  });

  // ---- 历史（读 + 删；写入无入口，spec §10.3 原则）----
  ipcMain.handle('hist-state', () => browserStore.getHistory());
  ipcMain.handle('hist-remove-one', (_e, id) => {
    const webHistory = require('../lib/web-history');
    browserStore.setHistory(webHistory.removeOne(browserStore.getHistory(), String(id)));
    pushHistory();
    return true;
  });
  ipcMain.handle('hist-clear', (_e, range) => {
    const webHistory = require('../lib/web-history');
    const ok = ['1h', '24h', '7d', 'all'];
    if (!ok.includes(range)) return false;
    browserStore.setHistory(webHistory.clearRange(browserStore.getHistory(), range, Date.now()));
    pushHistory();
    return true;
  });

  // ---- 浏览器设置（真 app 引擎表无 glass,默认 Bing,spec §4.10/§13）----
  ipcMain.handle('browser-settings', () => ({ ...browserStore.getSettings(), engines: engines.ORDER.map((k) => ({ key: k, name: engines.ENGINES[k].name })) }));
  ipcMain.handle('browser-set-engine', (_e, key) => browserStore.setEngine(key));

  // ---- 默认浏览器（设置页按钮）----
  // 只在打包态有意义：dev 跑的是 Electron.app，把它注册成系统 http handler 会污染开发机的
  // Launch Services（之后点链接弹 Electron 空壳），所以非打包直接拒。
  // macOS 上 setAsDefaultProtocolClient('http') 会触发系统确认弹窗，返回 true ≠ 用户已确认——
  // isDefault 要用户点完系统弹窗才翻真，UI 按「已请求」处理。
  ipcMain.handle('browser-default-status', () => ({
    isDefault: app.isPackaged && app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'),
    packaged: app.isPackaged
  }));
  ipcMain.handle('browser-set-default', () => {
    if (!app.isPackaged) return { ok: false, packaged: false, isDefault: false };
    const ok = app.setAsDefaultProtocolClient('http') && app.setAsDefaultProtocolClient('https');
    return { ok, packaged: true, isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https') };
  });

  // 退出前把防抖窗内的收藏/历史/设置变更冲盘。
  app.on('before-quit', () => browserStore.flushSync());
}

// bounds 只吃有限数字（renderer 报告内容区矩形；防坏值把 view 摆飞）。
function sanitizeBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
  const x = n(b.x), y = n(b.y), width = n(b.width), height = n(b.height);
  if (x == null || y == null || width == null || height == null) return null;
  return { x, y, width, height };
}

module.exports = { registerBrowserIpc };
