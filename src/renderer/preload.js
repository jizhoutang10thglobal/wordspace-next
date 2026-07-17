const { contextBridge, ipcRenderer } = require('electron');

// i18n:页面脚本跑之前就把 window.wsT 建好(同步)。主进程把「当前生效语言解析好的扁平字典」经 sendSync
// 送来(preload 是 sandboxed，不能 require 项目字典)，这里只做查表 + {param} 替换。缺 key → 显示 key 名。
// 语言切换走整窗 reload，故本页生命周期内字典固定；下次 reload 重新 sendSync 取新语言的字典。
(function () {
  let boot = { lang: 'zh', dict: {} };
  try { boot = ipcRenderer.sendSync('get-i18n-boot-sync') || boot; } catch (e) { /* 主进程未就绪等极端情况：wsT 回退显示 key 名 */ }
  const dict = boot.dict || {};
  function wsT(key, params) {
    let s = dict[key] != null ? dict[key] : key;
    if (params) {
      for (const k in params) s = s.split('{' + k + '}').join(String(params[k]));
    }
    return s;
  }
  contextBridge.exposeInMainWorld('wsT', wsT);
  contextBridge.exposeInMainWorld('wsLang', boot.lang || 'zh');
})();

contextBridge.exposeInMainWorld('ws2', {
  pickFile: () => ipcRenderer.invoke('pick-file'),
  pickImages: () => ipcRenderer.invoke('ws-pick-images'), // 图片插入：原生多选 → [{name, mime, base64}]
  classifyFile: (abs) => ipcRenderer.invoke('classify-file', abs),
  fileUrlAbs: (abs) => ipcRenderer.invoke('file-url-abs', abs),
  openExternalAbs: (abs) => ipcRenderer.invoke('open-external-abs', abs),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url), // 文档内 web 链接 → 系统浏览器/邮件
  resolveDocLink: (fromAbs, href) => ipcRenderer.invoke('ws-resolve-doc-link', fromAbs, href), // 相对链接解析（abs/rel/kind/exists）
  linksQuery: (rootId) => ipcRenderer.invoke('ws-links-query', rootId), // U2：全部文档 rel/title/kind
  linksCandidates: (rootId) => ipcRenderer.invoke('ws-links-candidates', rootId), // U3：@菜单候选（文档 + 非文档文件）
  linksCandidatesAll: (sourceRootId) => ipcRenderer.invoke('ws-links-candidates-all', sourceRootId), // B：@菜单跨根候选（所有根分组）
  wsSameVolume: (aId, bId) => ipcRenderer.invoke('ws-same-volume', aId, bId), // B：两根是否同磁盘卷（拖拽跨根建链约束）
  linksBacklinks: (rootId, rel) => ipcRenderer.invoke('ws-links-backlinks', rootId, rel), // U2：反链来源
  linksDirBacklinks: (rootId, dirRel) => ipcRenderer.invoke('ws-links-dir-backlinks', rootId, dirRel), // U6：文件夹夹外反链（删除守卫）
  linksOutlinksCount: (rootId, rel, isDir) => ipcRenderer.invoke('ws-links-outlinks-count', rootId, rel, isDir), // U-CR0：条目自身会断的出链数（跨根移动守卫）
  linksMovedTarget: (rootId, sourceRel, targetRel) => ipcRenderer.invoke('ws-links-moved-target', rootId, sourceRel, targetRel), // U7：断链目标 doc-id 反查现址
  linksRebuild: (rootId) => ipcRenderer.invoke('ws-links-rebuild', rootId), // U2：索引重建逃生门
  pathExists: (abs) => ipcRenderer.invoke('path-exists', abs),
  readDoc: (p) => ipcRenderer.invoke('read-doc', p),
  pathInfo: (p) => ipcRenderer.invoke('path-info', p),
  appVersion: () => ipcRenderer.invoke('app-version'),
  wsDiag: () => ipcRenderer.invoke('ws-diag'), // 诊断面板读主进程侧每根成本
  // 自动更新（应用内面板）：状态/展示模型都在 main 算好整包推来，renderer 纯渲染
  updateGetStatus: () => ipcRenderer.invoke('update-get-status'), // 启动补拉（解「事件先于 renderer 就绪」竞态）
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  updateOpenChangelog: () => ipcRenderer.invoke('update-open-changelog'), // 更新日志页 → app 内网页标签
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, payload) => cb(payload)),
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
  onWsTreeChanged: (cb) => ipcRenderer.on('ws-tree-changed', (_e, rootId, changedDirs) => cb(rootId, changedDirs)), // changedDirs: 受影响目录（子树级重扫）| null=全量
  onLinksUpdated: (cb) => ipcRenderer.on('links-index-updated', (_e, rootId) => cb(rootId)), // U2：索引刷新 → 反链面板/断链装饰刷新
  onWsRootsChanged: (cb) => ipcRenderer.on('ws-roots-changed', () => cb()), // 运行时根状态变化（如拔盘转失联）→ 重拉根列表
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  // 外观三态：偏好归 main 管（唯一真相源，驱动 nativeTheme）；renderer 只查/设/听。
  // chrome 走 data-theme（main 广播 effective），因 themeSource 不 live 更新 renderer prefers-color-scheme。
  getAppearance: () => ipcRenderer.invoke('get-appearance'),
  getEffectiveTheme: () => ipcRenderer.invoke('get-effective-theme'),
  setAppearance: (pref) => ipcRenderer.send('set-appearance', pref),
  onAppearanceChanged: (cb) => ipcRenderer.on('appearance-changed', (_e, payload) => cb(payload)),

  // 语言三态：偏好归 main 管（唯一真相源，驱动菜单/对话框/renderer 显示语言）；renderer 查/设/听。
  // 字典本体经 i18nBoot() 一次性注入（U4），renderer 用全局 window.wsT 翻译、不逐次跨桥。
  getLanguage: () => ipcRenderer.invoke('get-language'),
  getEffectiveLang: () => ipcRenderer.invoke('get-effective-lang'),
  setLanguage: (pref) => ipcRenderer.send('set-language', pref),
  onLanguageChanged: (cb) => ipcRenderer.on('language-changed', (_e, payload) => cb(payload)),

  // 本地文件夹工作区 (F06 → 多根)：文件操作一律 (rootId, relPath)，renderer 只用 rootId 引用根、不发路径。
  wsAddFolder: () => ipcRenderer.invoke('ws-add-folder'),
  wsAddFolderConfirm: (token) => ipcRenderer.invoke('ws-add-folder-confirm', token), // 病灶路径「仍要打开」确认（P0a U4）
  wsAbsorbConfirm: (token) => ipcRenderer.invoke('ws-absorb-confirm', token),
  wsRemoveRoot: (rootId) => ipcRenderer.invoke('ws-remove-root', rootId),
  wsUndoRemoveRoot: (token) => ipcRenderer.invoke('ws-undo-remove-root', token),
  wsRelocateRoot: (rootId) => ipcRenderer.invoke('ws-relocate-root', rootId),
  wsReorderRoots: (ids) => ipcRenderer.invoke('ws-reorder-roots', ids),
  wsGetRoots: () => ipcRenderer.invoke('ws-get-roots'),
  wsReadTree: (rootId) => ipcRenderer.invoke('ws-read-tree', rootId),
  wsGetTreeState: () => ipcRenderer.invoke('ws-get-tree-state'), // P3-07 树展开态持久化（缓存语义）
  wsSetTreeState: (ts) => ipcRenderer.invoke('ws-set-tree-state', ts),
  wsReadSubtrees: (rootId, dirs) => ipcRenderer.invoke('ws-read-subtrees', rootId, dirs), // 子树级重扫;null=回落全量
  wsReadDir: (rootId, dirRel) => ipcRenderer.invoke('ws-read-dir', rootId, dirRel), // P0b lazy 模式：单层读取（展开哪层读哪层）
  wsWatchFlush: (rootId) => ipcRenderer.invoke('ws-watch-flush', rootId), // 聚焦兜底:冲在途去抖,返回 {alive}
  wsNewDoc: (rootId, dirRel, base, html, ext) => ipcRenderer.invoke('ws-new-doc', rootId, dirRel, base, html, ext),
  wsSaveDocAs: (base, html, ext, opts) => ipcRenderer.invoke('ws-save-doc-as', base, html, ext, opts), // ext 'md'=写盘前转 md；opts.reveal=导出语义 Finder 高亮
  wsMakeDir: (rootId, dirRel, name) => ipcRenderer.invoke('ws-make-dir', rootId, dirRel, name),
  wsAbs: (rootId, rel) => ipcRenderer.invoke('ws-abs', rootId, rel), // U6 反链：rel → abs（openDoc 用）
  wsRename: (rootId, relPath, newLeaf, openAbs) => ipcRenderer.invoke('ws-rename', rootId, relPath, newLeaf, openAbs),
  wsMove: (rootId, relPath, destDirRel, openAbs) => ipcRenderer.invoke('ws-move', rootId, relPath, destDirRel, openAbs),
  wsRewriteMoves: (rootId, moves, openAbs) => ipcRenderer.invoke('ws-rewrite-moves', rootId, moves, openAbs), // U5 外部改名探测「一键更新」
  wsMoveAcross: (fromRootId, relPath, toRootId, destDirRel, openAbs) => ipcRenderer.invoke('ws-move-across', fromRootId, relPath, toRootId, destDirRel, openAbs), // C2：openAbs=打开中文档 abs（主进程重写时跳过它，renderer 内存改）
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
  webCapture: (key) => ipcRenderer.invoke('webtab-capture', key), // 弹层摘 view 前的垫底快照
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

  // ---- 沉浸窗框（immersive-collapse spec）----
  platform: process.platform, // renderer 判 is-mac（hiddenInset 红绿灯让位只在 darwin 生效）
  setWindowButtons: (v) => ipcRenderer.send('ws-window-buttons', !!v),
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
  // 下载（spec §4.11；list 补拉 + 动作 + 变更推送。进度环/popover 由 onDownloadsChanged 驱动）
  dlList: () => ipcRenderer.invoke('dl-list'),
  dlCancel: (id) => ipcRenderer.send('dl-cancel', id),
  dlRetry: (id) => ipcRenderer.send('dl-retry', id),
  dlClear: () => ipcRenderer.send('dl-clear'),
  dlRemove: (id) => ipcRenderer.send('dl-remove', id),
  dlReveal: (id) => ipcRenderer.invoke('dl-reveal', id),
  onDownloadsChanged: (cb) => ipcRenderer.on('downloads-changed', (_e, data) => cb(data)),
  // 浏览器设置（搜索引擎；真 app 默认 Bing,拍板）
  browserSettings: () => ipcRenderer.invoke('browser-settings'),
  browserSetEngine: (key) => ipcRenderer.invoke('browser-set-engine', key),
  // 默认浏览器（设置页；macOS set 会触发系统确认弹窗）
  browserDefaultStatus: () => ipcRenderer.invoke('browser-default-status'),
  browserSetDefault: () => ipcRenderer.invoke('browser-set-default')
});
