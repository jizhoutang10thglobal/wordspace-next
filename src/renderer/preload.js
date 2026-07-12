const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ws2', {
  pickFile: () => ipcRenderer.invoke('pick-file'),
  classifyFile: (abs) => ipcRenderer.invoke('classify-file', abs),
  fileUrlAbs: (abs) => ipcRenderer.invoke('file-url-abs', abs),
  openExternalAbs: (abs) => ipcRenderer.invoke('open-external-abs', abs),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url), // 文档内 web 链接 → 系统浏览器/邮件
  resolveDocLink: (fromAbs, href) => ipcRenderer.invoke('ws-resolve-doc-link', fromAbs, href), // 相对链接解析（abs/rel/kind/exists）
  linksQuery: (rootId) => ipcRenderer.invoke('ws-links-query', rootId), // U2：全部文档 rel/title/kind
  linksCandidates: (rootId) => ipcRenderer.invoke('ws-links-candidates', rootId), // U3：@菜单候选（文档 + 非文档文件）
  linksBacklinks: (rootId, rel) => ipcRenderer.invoke('ws-links-backlinks', rootId, rel), // U2：反链来源
  linksRebuild: (rootId) => ipcRenderer.invoke('ws-links-rebuild', rootId), // U2：索引重建逃生门
  pathExists: (abs) => ipcRenderer.invoke('path-exists', abs),
  readDoc: (p) => ipcRenderer.invoke('read-doc', p),
  pathInfo: (p) => ipcRenderer.invoke('path-info', p),
  appVersion: () => ipcRenderer.invoke('app-version'),
  wsDiag: () => ipcRenderer.invoke('ws-diag'), // 诊断面板读主进程侧每根成本
  diagRecordProfile: (ms) => ipcRenderer.invoke('diag-record-profile', ms), // 诊断面板：录 N 毫秒 CPU profile 存桌面
  saveDoc: (p, c) => ipcRenderer.invoke('save-doc', p, c),
  exportPdf: (p, mode, html, opts) => ipcRenderer.invoke('export-pdf', p, mode, html, opts),
  recents: () => ipcRenderer.invoke('recents-list'),
  recentsAdd: (p) => ipcRenderer.invoke('recents-add', p),
  historyList: (p) => ipcRenderer.invoke('history-list', p),
  historyRead: (p, id) => ipcRenderer.invoke('history-read', p, id),
  setDirty: (v) => ipcRenderer.send('set-dirty', v),
  winClose: () => ipcRenderer.send('win-close'), // Cmd+W 空态：关窗口（主进程按平台分流：macOS 隐藏驻留/其他退出）
  watchDoc: (p) => ipcRenderer.send('watch-doc', p),
  unwatchDoc: () => ipcRenderer.send('unwatch-doc'),
  onDocChanged: (cb) => ipcRenderer.on('doc-changed', (_e, p) => cb(p)),
  onWsTreeChanged: (cb) => ipcRenderer.on('ws-tree-changed', (_e, rootId) => cb(rootId)),
  onLinksUpdated: (cb) => ipcRenderer.on('links-index-updated', (_e, rootId) => cb(rootId)), // U2：索引刷新 → 反链面板/断链装饰刷新
  onWsRootsChanged: (cb) => ipcRenderer.on('ws-roots-changed', () => cb()), // 运行时根状态变化（如拔盘转失联）→ 重拉根列表
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),

  // 本地文件夹工作区 (F06 → 多根)：文件操作一律 (rootId, relPath)，renderer 只用 rootId 引用根、不发路径。
  wsAddFolder: () => ipcRenderer.invoke('ws-add-folder'),
  wsAbsorbConfirm: (token) => ipcRenderer.invoke('ws-absorb-confirm', token),
  wsRemoveRoot: (rootId) => ipcRenderer.invoke('ws-remove-root', rootId),
  wsUndoRemoveRoot: (token) => ipcRenderer.invoke('ws-undo-remove-root', token),
  wsRelocateRoot: (rootId) => ipcRenderer.invoke('ws-relocate-root', rootId),
  wsReorderRoots: (ids) => ipcRenderer.invoke('ws-reorder-roots', ids),
  wsGetRoots: () => ipcRenderer.invoke('ws-get-roots'),
  wsReadTree: (rootId) => ipcRenderer.invoke('ws-read-tree', rootId),
  wsNewDoc: (rootId, dirRel, base, html) => ipcRenderer.invoke('ws-new-doc', rootId, dirRel, base, html),
  wsSaveDocAs: (base, html, ext, opts) => ipcRenderer.invoke('ws-save-doc-as', base, html, ext, opts), // ext 'md'=写盘前转 md；opts.reveal=导出语义 Finder 高亮
  wsMakeDir: (rootId, dirRel, name) => ipcRenderer.invoke('ws-make-dir', rootId, dirRel, name),
  wsRename: (rootId, relPath, newLeaf) => ipcRenderer.invoke('ws-rename', rootId, relPath, newLeaf),
  wsMove: (rootId, relPath, destDirRel) => ipcRenderer.invoke('ws-move', rootId, relPath, destDirRel),
  wsMoveAcross: (fromRootId, relPath, toRootId, destDirRel) => ipcRenderer.invoke('ws-move-across', fromRootId, relPath, toRootId, destDirRel),
  wsDelete: (rootId, relPath) => ipcRenderer.invoke('ws-delete', rootId, relPath),
  wsUndoDelete: (rootId, token) => ipcRenderer.invoke('ws-undo-delete', rootId, token),
  wsOpenExternal: (rootId, relPath) => ipcRenderer.invoke('ws-open-external', rootId, relPath),
  wsFileUrl: (rootId, relPath) => ipcRenderer.invoke('ws-file-url', rootId, relPath),
  wsGetTabs: () => ipcRenderer.invoke('ws-get-tabs'),
  wsSetTabs: (state) => ipcRenderer.invoke('ws-set-tabs', state),
  wsTemplates: () => ipcRenderer.invoke('ws-templates'),
  aiGuide: () => ipcRenderer.invoke('ai-guide'),

  // ---- 浏览器 feature（spec docs/browser-feature-spec.md §10.3）----
  // 网页标签 view：renderer 激活漏斗驱动 show/hide/bounds；导航 parse 在主进程（引擎模板从设置取）。
  webNavigate: (key, input) => ipcRenderer.invoke('webtab-navigate', key, input),
  webLoadUrl: (key, url) => ipcRenderer.invoke('webtab-load-url', key, url),
  webNav: (key, action) => ipcRenderer.send('webtab-nav', key, action),
  webShow: (key, bounds) => ipcRenderer.send('webtab-show', key, bounds),
  webHideAll: () => ipcRenderer.send('webtab-hide-all'),
  webSetBounds: (key, bounds) => ipcRenderer.send('webtab-bounds', key, bounds),
  webClose: (key) => ipcRenderer.send('webtab-close', key),
  webFind: (key, text, opts) => ipcRenderer.send('webtab-find', key, text, opts),
  webFindStop: (key, action) => ipcRenderer.send('webtab-find-stop', key, action),
  webZoom: (key, dir) => ipcRenderer.send('webtab-zoom', key, dir),
  webExportPdf: (key) => ipcRenderer.invoke('webtab-export-pdf', key),
  onWebTabUpdated: (cb) => ipcRenderer.on('web-tab-updated', (_e, s) => cb(s)),
  onWebOpenRequest: (cb) => ipcRenderer.on('web-open-request', (_e, r) => cb(r)),
  onWebFound: (cb) => ipcRenderer.on('web-found', (_e, r) => cb(r)),
  onWebToast: (cb) => ipcRenderer.on('web-toast', (_e, msg) => cb(msg)),
  onWebShortcut: (cb) => ipcRenderer.on('web-shortcut', (_e, r) => cb(r)),
  // 收藏（主进程持久化 + 变更推全量,renderer 内存镜像做逐键补全）
  bmState: () => ipcRenderer.invoke('bm-state'),
  bmAdd: (b) => ipcRenderer.invoke('bm-add', b),
  bmRemoveByUrl: (url) => ipcRenderer.invoke('bm-remove-by-url', url),
  bmRemoveOne: (id) => ipcRenderer.invoke('bm-remove-one', id),
  bmUpdate: (id, patch) => ipcRenderer.invoke('bm-update', id, patch),
  bmAddFolder: (name) => ipcRenderer.invoke('bm-add-folder', name),
  bmRenameFolder: (id, name) => ipcRenderer.invoke('bm-rename-folder', id, name),
  bmRemoveFolder: (id) => ipcRenderer.invoke('bm-remove-folder', id),
  bmExport: () => ipcRenderer.invoke('bm-export'),
  bmImport: () => ipcRenderer.invoke('bm-import'),
  onBookmarksChanged: (cb) => ipcRenderer.on('bookmarks-changed', (_e, s) => cb(s)),
  // 历史（写入无 renderer 入口；只读 + 删）
  histState: () => ipcRenderer.invoke('hist-state'),
  histRemoveOne: (id) => ipcRenderer.invoke('hist-remove-one', id),
  histClear: (range) => ipcRenderer.invoke('hist-clear', range),
  onHistoryChanged: (cb) => ipcRenderer.on('history-changed', (_e, s) => cb(s)),
  // 浏览器设置（搜索引擎；真 app 默认 Bing,拍板）
  browserSettings: () => ipcRenderer.invoke('browser-settings'),
  browserSetEngine: (key) => ipcRenderer.invoke('browser-set-engine', key)
});
