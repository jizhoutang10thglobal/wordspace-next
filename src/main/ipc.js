const { ipcMain, dialog, app, BrowserWindow, shell } = require('electron');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const files = require('./files');
const history = require('./history');
const recents = require('./recents');
const docWatcher = require('./doc-watcher');
const workspaceWatcher = require('./workspace-watcher');
const workspace = require('./workspace');
const workspaceStore = require('./workspace-store');
const perfDiag = require('./perf-diag');
const { exportPdf, exportPdfFromHtml } = require('./pdf-export');
const mdAdapter = require('./md-adapter');
const { pathInfo } = require('../lib/path-url');
const { assertInsideWorkspace, kindOf, isNoisePath, affectedDirsOf } = require('../lib/file-tree');
const { TEMPLATES } = require('../lib/doc-templates');
const rootsLib = require('../lib/roots');
const tabsLib = require('../lib/tabs'); // 吸收时把持久化标签同步 rebase（双导出 IIFE，主进程可 require）
const linkIndex = require('./link-index'); // U2 文档互链索引（可丢弃缓存，多根 rootId:rel 键）
const linkRewrite = require('./link-rewrite'); // U5 改名/移动 → 字节保真重写引用
const wsLinks = require('../lib/links'); // 路径代数（invertMoves/resolveHref/relHref）
const docIdLib = require('../lib/doc-id'); // U7 双层身份修复锚（wordspace-doc-id meta）
const crypto = require('crypto'); // U7 doc-id 生成（randomUUID）
const { registerBrowserIpc } = require('./browser-ipc'); // 浏览器 feature（网页标签/收藏/历史/设置,spec §10.3）

const historyRoot = () => path.join(app.getPath('userData'), 'history');
const recentsFile = () => path.join(app.getPath('userData'), 'recents.json');
const workspaceFile = () => path.join(app.getPath('userData'), 'workspace.json');
const linkIndexFile = () => path.join(app.getPath('userData'), 'link-index.json');
const trashRoot = () => path.join(app.getPath('userData'), '.ws2-trash');

// 根注册表（多根）：服务端唯一真相。所有文件操作只收 (rootId, relPath)、路径由注册表解析——
// 渲染层永远不发根路径（防篡改 workspace.json / IPC 注入任意根越权），只能用 rootId 引用已注册的根。
// roots 有序 = 侧栏显示序。missing = 路径不可达（外置盘拔了/被删），操作被拒但注册不丢、可重新定位。
// r.real = 注册时的 realpath（软链归一化，给 classify-file / classifyRoot 用；失败回落 r.path）。
let roots = []; // [{ id, path, real, missing }]
let nextRootId = 1;
let rootsRestorePromise = null; // 首次 ws-get-roots 从 store 恢复（幂等）
const MAX_ROOTS = 8; // 每根一个递归 watcher，封顶控资源（JetBrains 官方警告 attach 多了拖性能）
const pendingAbsorb = new Map(); // token → { path, real } 等确认的「父目录吸收」
const removedStash = new Map(); // token → { root, index } 可撤销的「移除根」
let stashSeq = 1;

function rootById(rootId) {
  const r = roots.find((x) => x.id === rootId);
  if (!r) throw new Error('未知的工作区根: ' + rootId);
  if (r.missing) throw new Error('工作区文件夹失联: ' + rootId);
  return r.path;
}
function rootInfo(r) {
  return { id: r.id, path: r.path, name: path.basename(r.path) || r.path, missing: !!r.missing };
}
function classifyRoots() {
  // classify 用 realpath 归一化后的路径（软链两侧都归一才可比）
  return roots.map((r) => ({ id: r.id, path: r.real || r.path }));
}
async function persistRoots() {
  await workspaceStore.saveRoots(
    workspaceFile(),
    roots.map((r) => ({ id: r.id, path: r.path })),
    nextRootId,
  );
}
async function canonReal(p) {
  const resolved = path.resolve(p);
  try {
    return await fsp.realpath(resolved);
  } catch {
    return resolved;
  }
}
// 起对某根的递归监听：外部增删改 → 通知 renderer 重读该根的树 + reconcile 标签（事件带 rootId +
// 变化目录列表）。watcher 挂了（拔盘/根被删）→ 复查可达性：真没了标 missing + 广播（renderer 重拉根列表
// 渲染失联态）；还在（瞬时错误）→ 重新挂监听。没有这步，运行中拔盘的根会「树冻结在旧状态、永不转失联」（MR-ADV-4）。
// 大根性能：噪音事件在 watcher 层直接丢（isNoise）；报得出变化路径就归并成「受影响目录」（affectedDirsOf）
// 让 renderer 走子树级重扫（ws-read-subtrees），归并不出来（根层变化/路径太散/平台没给路径）才发 null = 全量。
function startRootWatch(root) {
  workspaceWatcher.watch(
    root.id,
    root.path,
    (changedRels) => {
      perfDiag.recordWatch(root.path); // 诊断探针：数这个根被 watcher 触发几次（云盘 churn 会很高）
      const dirs = changedRels ? affectedDirsOf(changedRels) : null;
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.webContents.isDestroyed()) w.webContents.send('ws-tree-changed', root.id, dirs);
      }
      refreshLinkIndex(root.id); // U2：外部增删改 → 增量刷新该根链接索引（内部去抖/串行）
    },
    async () => {
      if (await dirExists(root.path)) { startRootWatch(root); return; }
      markRootMissing(root);
    },
    { isNoise: isNoisePath, delayMs: () => perfDiag.suggestDebounceMs(root.path) },
  );
}
// 运行时转失联（幂等）：标 missing + 广播根列表变化。missing 不持久化（重启时 restoreRoots 重新判定）。
function markRootMissing(root) {
  if (root.missing || !roots.includes(root)) return;
  root.missing = true;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send('ws-roots-changed');
  }
}
// ---- U2 文档互链索引：每根一份可丢弃缓存。懒建（首次 query/backlinks 才建，用户从不互链的根不花代价）；
// 树变化时增量刷新；根移除时丢弃。所有索引变更按 rootId 串行化（防并发 refresh 竞态改同一 Map）。----
const linkBuilt = new Set(); // 已建过索引的 rootId
const linkChain = new Map(); // rootId → 上一个索引操作的 promise（串行链）
const linkRefreshPending = new Set(); // 已有一次「树变化增量刷新」在排队的 rootId（合并突发变更，审查 #3）
let linkSaveTimer = null;
// 丢弃某根的全部索引态（root 移除/被吸收/重定位前调，对齐三处入口，防泄漏 + 陈旧 byPath 反复入盘）。
function dropLinkIndex(rootId) {
  linkIndex.removeRoot(rootId); linkBuilt.delete(rootId); linkChain.delete(rootId); linkRefreshPending.delete(rootId);
}
function queueLink(rootId, fn) {
  const prev = linkChain.get(rootId) || Promise.resolve();
  const next = prev.then(fn, fn).catch(() => {}); // 无论上一步成败都接着跑，异常吞掉（索引尽力而为）
  linkChain.set(rootId, next);
  return next;
}
function scheduleLinkSave() {
  if (linkSaveTimer) clearTimeout(linkSaveTimer);
  // keepPaths = 当前注册表所有根的 path：save 合并保留未加载根的缓存、剪掉已移除根的陈旧条目（审查 B）。
  linkSaveTimer = setTimeout(() => { linkSaveTimer = null; linkIndex.save(linkIndexFile(), new Set(roots.map((r) => r.path))).catch(() => {}); }, 1500);
}
function broadcastLinksUpdated(rootId) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send('links-index-updated', rootId);
  }
}
function liveRoot(rootId) { return roots.find((r) => r.id === rootId && !r.missing) || null; }
// 确保某根索引已建（首访 hydrate 热缓存 + 一次 refresh 对磁盘校对；之后只增量）。
function ensureLinkIndex(rootId) {
  return queueLink(rootId, async () => {
    const root = liveRoot(rootId);
    if (!root) return;
    if (!linkBuilt.has(rootId)) { await linkIndex.hydrate(linkIndexFile(), rootId, root.path).catch(() => {}); linkBuilt.add(rootId); }
    await linkIndex.refreshRoot(rootId, root.path);
    scheduleLinkSave();
  });
}
// 跨根 fan-out 查询（反链/删除守卫）前，确保**所有 live 根**都建过索引——否则源在别的、尚未懒建的根里会漏。
// 首次可能重（逐根建），之后走增量；用户主动触发的查询，可接受（plan N4）。
function ensureAllLinkIndexes() {
  return Promise.all(roots.filter((r) => !r.missing).map((r) => ensureLinkIndex(r.id)));
}
// 树变化后增量刷新（只对已建过索引的根——没建过的等被 query 时懒建）。变了才广播 + 存盘。
// 合并突发（审查 #3）：已排队一次刷新就不再叠加——排队的那次进入执行时会读到最新磁盘、覆盖执行前的全部变更。
function refreshLinkIndex(rootId) {
  if (!linkBuilt.has(rootId) || linkRefreshPending.has(rootId)) return Promise.resolve();
  linkRefreshPending.add(rootId);
  return queueLink(rootId, async () => {
    linkRefreshPending.delete(rootId); // 进入执行 → 执行期间的新变更可再排一次
    const root = liveRoot(rootId);
    if (!root) return;
    const changed = await linkIndex.refreshRoot(rootId, root.path);
    if (changed) { broadcastLinksUpdated(rootId); scheduleLinkSave(); }
  });
}

// ---- U5+C 改名/移动 → 自动重写引用（字节保真，handoff §5.4；C：绝对路径域 + fan-out 所有根，跨根引用也跟着改）----
const relOf = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
function liveRootDirs() { return roots.filter((r) => !r.missing).map((r) => r.path); } // 判短/长形式 + fan-out 目标
// 一次改名/移动 → **abs moves**（absOld → absNew）。文件=单条；文件夹=子树每个文档。fromDir/toDir 可不同根（跨根移动）。
async function computeMovesAbs(fromDir, oldRel, toDir, newRel) {
  const moves = new Map();
  const j = (dir, rel) => path.join(dir, rel.split('/').join(path.sep));
  const newAbs = j(toDir, newRel);
  let isDir = false;
  try { isDir = (await fsp.stat(newAbs)).isDirectory(); } catch (e) {}
  if (!isDir) { moves.set(j(fromDir, oldRel), newAbs); return moves; }
  const docs = await workspace.listDocs(toDir).catch(() => []);
  for (const r of docs) {
    if (r === newRel || r.indexOf(newRel + '/') === 0) moves.set(j(fromDir, oldRel + r.slice(newRel.length)), j(toDir, r));
  }
  return moves;
}
// 按 abs moves 重写**所有 live 根**的文档（字节保真，C fan-out——跨根引用也修）。skipAbs=打开中文档（renderer 内存改）。
// 归档旧字节做安全网/撤销源。返回 { count, changedRootIds }。
async function rewriteRefsForMovesAbs(movesAbs, skipAbs) {
  const rootDirs = liveRootDirs();
  const invAbs = new Map(); for (const [o, n] of movesAbs) invAbs.set(n, o); // absNew → absOld（被移动的文件才有）
  const skipNewAbs = skipAbs ? (movesAbs.get(skipAbs) || skipAbs) : null; // 打开中文档也可能被移动 → 跳它的新 abs
  let count = 0;
  const changedRootIds = new Set();
  for (const r of roots.filter((x) => !x.missing)) {
    const rels = await workspace.listDocs(r.path).catch(() => []);
    for (const rel of rels) {
      const abs = path.join(r.path, rel.split('/').join(path.sep));
      if (abs === skipNewAbs) continue; // 打开中的文档交给 renderer 内存改
      let raw;
      try { raw = await fsp.readFile(abs, 'utf8'); } catch (e) { continue; }
      const ownOldAbs = invAbs.get(abs) || abs; // 自己被移动了？用旧 abs 解析既有 href
      const isMd = mdAdapter.isMdPath(abs);
      let res;
      try { res = await linkRewrite.rewriteContentAbs(raw, ownOldAbs, abs, movesAbs, isMd, rootDirs); } catch (e) { continue; }
      if (!res.changed) continue;
      const prev = await files.readDocBuffer(abs).catch(() => null);
      if (prev !== null) await history.archive(historyRoot(), abs, prev).catch(() => {}); // 安全网/撤销源
      try { await files.writeDocSafe(abs, res.content, { allowWhitespaceOnly: isMd }); count++; changedRootIds.add(r.id); } catch (e) {}
    }
  }
  return { count, changedRootIds };
}
// 改名/移动收口（同根 fromDir===toDir / 跨根不同）：算 abs moves → fan-out 重写 → 刷受影响根索引 →
// 返回 { rewritten, moves }（moves = abs，给 renderer 改打开中文档）。
async function rewriteAfterMoveAbs(fromDir, fromRootId, oldRel, toDir, toRootId, newRel, openAbs) {
  if (fromDir === toDir && newRel === oldRel) return { rewritten: 0, moves: [] }; // 同名 no-op
  const movesAbs = await computeMovesAbs(fromDir, oldRel, toDir, newRel);
  const { count, changedRootIds } = await rewriteRefsForMovesAbs(movesAbs, openAbs);
  changedRootIds.add(fromRootId); changedRootIds.add(toRootId); // 移动本身也让两根索引变
  for (const id of changedRootIds) refreshLinkIndex(id);
  return { rewritten: count, moves: [...movesAbs] };
}
// 同根改名/移动的收口（ws-rename/ws-move 用；fromDir===toDir===root）。
function rewriteAfterMove(root, rootId, oldRel, newRel, openAbs) {
  return rewriteAfterMoveAbs(root, rootId, oldRel, root, rootId, newRel, openAbs);
}

// 启动恢复（幂等，首次 ws-get-roots 触发）：store 里的每个根检查可达性，失联的标 missing 不悄悄丢。
async function restoreRoots() {
  if (!rootsRestorePromise) {
    rootsRestorePromise = (async () => {
      const saved = await workspaceStore.loadState(workspaceFile());
      nextRootId = saved.nextRootId;
      for (const r of saved.roots) {
        const missing = !(await dirExists(r.path));
        const root = { id: r.id, path: r.path, real: missing ? r.path : await canonReal(r.path), missing };
        roots.push(root);
        if (!missing) startRootWatch(root);
      }
    })();
  }
  return rootsRestorePromise;
}
async function dirExists(p) {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// 纵深防御：读写只接受 .html/.htm/.md 路径（可编辑文档；md 走读写两端适配，见 md-adapter）。
// 这道守卫挡住「篡改 recents.json 注入 /etc/passwd 等任意路径越权读写」的向量，不影响正常流。
function assertDocPath(p) {
  if (typeof p !== 'string' || !/\.(html?|md)$/i.test(p)) throw new Error('只支持 .html/.htm/.md 文件：' + p);
}

function registerIpc() {
  ipcMain.handle('pick-file', async () => {
    // 放开到任意类型（原来只放 HTML）：「打开」按钮要能开 PDF/图片/Word 等，renderer 再按 kind 分流
    //（html→编辑器 / 图片·PDF→应用内查看器 / 其余→默认程序打开）。所有文件在前作默认筛选，HTML 仍单列一项。
    const r = await dialog.showOpenDialog({
      filters: [
        { name: '所有文件', extensions: ['*'] },
        { name: 'HTML 文档', extensions: ['html', 'htm'] },
        { name: 'Markdown 文档', extensions: ['md'] },
      ],
      properties: ['openFile']
    });
    return r.canceled ? null : r.filePaths[0];
  });
  // 给「打开」按钮选到的任意绝对路径分类：kind（按扩展名）+ 文件名 + 若在某个已打开的根内则算出
  // (rootId, rel)（否则 null=工作区外）。abs 用 realpath 归一化后跟各根的 realpath 比——macOS 上
  // /tmp→/private/tmp 这类软链会让原始 abs 对不上，不归一化的话「根内文件」也会被判成外部、建不出树标签。
  ipcMain.handle('classify-file', async (_e, abs) => {
    const name = path.basename(abs);
    const kind = kindOf(name);
    let rel = null;
    let rootId = null;
    try {
      const real = await fsp.realpath(abs);
      const live = roots.filter((r) => !r.missing).map((r) => ({ id: r.id, path: r.real || r.path }));
      const owner = rootsLib.ownerOf(real, live);
      if (owner && owner.rel) {
        rel = owner.rel;
        rootId = owner.rootId;
      }
    } catch { /* abs 不存在 / 无法 realpath：rel 留 null（当作工作区外处理） */ }
    return { name, kind, rel, rootId };
  });
  // 工作区外文件（「打开」按钮自由选择）的 file:// URL / 默认程序打开。不经 assertInsideWorkspace：这些 abs
  // 不是 workspace-relative、也不来自可被篡改的 recents/workspace.json，而是用户当场在原生 showOpenDialog
  // 里亲手选的（可信来源）。仅服务「打开」按钮这一条 pick→view 流，别把这两个 IPC 接到其它入口。
  ipcMain.handle('file-url-abs', (_e, abs) => pathToFileURL(abs).href);
  // 修 MP-6：shell.openPath 失败不抛、resolve 一个错误串（无关联程序/文件刚被删）。原来无条件 {ok:true} →
  // 「用默认程序打开」失败时用户完全无感。检查返回串，非空转 {error} 让 renderer 弹提示。
  ipcMain.handle('open-external-abs', async (_e, abs) => { const err = await shell.openPath(abs); return err ? { error: err } : { ok: true }; });
  // 文档里的 web 链接（http/https/mailto/tel）→ 系统默认程序（浏览器/邮件）。**白名单 scheme**——
  // 绝不把任意串交给 shell.openExternal（file:/javascript: 等可越权/危险）；renderer 已先 classifyScheme='web'，这里二次设防。
  ipcMain.handle('open-external-url', async (_e, url) => {
    if (typeof url !== 'string' || !/^(https?|mailto|tel):/i.test(url)) return { error: 'blocked scheme' };
    try { await shell.openExternal(url); return { ok: true }; }
    catch (e) { return { error: String((e && e.message) || e) }; }
  });
  // 文档内相对链接（renderer 已判定 kind='relative'）解析：按浏览器 URL 语义把 href 相对文档目录解析成绝对路径
  //（自动处理 ../ / 百分号解码，与「浏览器裸开可跳」一致），再算 root 内 rel（realpath 防软链越界）、kind、是否存在。
  // 供 U0 点击收口 + 后续 U4 点击导航/断链判定共用。
  ipcMain.handle('ws-resolve-doc-link', async (_e, fromAbs, href) => {
    if (typeof fromAbs !== 'string' || typeof href !== 'string') return { error: 'bad args' };
    let url;
    try { url = new URL(href, pathToFileURL(fromAbs)); }
    catch (e) { return { error: 'unresolvable' }; }
    // 安全闸（在任何 fs 调用之前）：只认本机 file:// 且 host 为空。非 file:（漏网 scheme）或 host 非空
    //（'\\host\share' 被 WHATWG 规范成 file://host/… → Windows 上 realpath/stat 会出站 SMB、泄漏 NTLM 哈希）
    // 一律拒，绝不对远程/UNC 路径做 realpath/stat。
    if (url.protocol !== 'file:' || url.host) return { error: 'unresolvable' };
    let abs;
    try { abs = fileURLToPath(url); }
    catch (e) { return { error: 'unresolvable' }; }
    const name = path.basename(abs);
    const kind = kindOf(name);
    let rel = null;
    let rootId = null;
    try {
      // 目标可能不存在（断链）→ 不能 realpath abs 本身。realpath 它的**父目录**（链接在根内时父目录存在）
      // 再拼 basename，得到与各根 realpath 同一软链归一的路径，交 ownerOf 判归属（多根：命中哪个根就返回那个 rootId+rel）。
      const dirReal = await fsp.realpath(path.dirname(abs)).catch(() => path.dirname(abs));
      const real = path.join(dirReal, name);
      const live = roots.filter((r) => !r.missing).map((r) => ({ id: r.id, path: r.real || r.path }));
      const owner = rootsLib.ownerOf(real, live);
      if (owner && owner.rel) { rel = owner.rel; rootId = owner.rootId; }
    } catch { /* 算不出归属 → 当工作区外 */ }
    // 只对根内目标探测存在性——不 stat 越界路径（否则文档字节可借链接点击嗅探磁盘任意路径是否存在）。
    let exists = false;
    if (rel != null) { try { exists = (await fsp.stat(abs)).isFile(); } catch { /* 根内但不存在 → 断链 */ } }
    return { abs, rel, rootId, kind, name, exists, insideRoot: rel != null };
  });
  // U2 链接索引查询面（@菜单候选 / 反链 / 逃生门重建）。懒建：首次访问才建该根索引。
  ipcMain.handle('ws-links-query', async (_e, rootId) => { await ensureLinkIndex(rootId); return linkIndex.query(rootId); });
  // @菜单候选：文档（索引，带标题）+ 非文档文件（pdf/图片等，文件名）。docs 在前、others 在后。
  ipcMain.handle('ws-links-candidates', async (_e, rootId) => {
    await ensureLinkIndex(rootId);
    const root = liveRoot(rootId);
    const others = root ? await linkIndex.listNonDocFiles(root.path).catch(() => []) : [];
    return { docs: linkIndex.query(rootId), others };
  });
  // B @菜单跨根候选：所有 live 根分组返回。sourceRootId = 触发 @ 的文档所在根 → 排在最前（组内行为与单根现状一致，单根用户零感知）。
  // sameVol = 与源根同磁盘卷（stat().dev 相等）；跨卷根不给建链（B 层可见拒绝，renderer 灰字提示、不列候选）。
  ipcMain.handle('ws-links-candidates-all', async (_e, sourceRootId) => {
    await ensureAllLinkIndexes();
    const live = roots.filter((r) => !r.missing);
    const devOf = async (p) => { try { return (await fsp.stat(p)).dev; } catch { return null; } };
    const srcRoot = live.find((r) => r.id === sourceRootId);
    const srcDev = srcRoot ? await devOf(srcRoot.path) : null;
    const ordered = srcRoot ? [srcRoot, ...live.filter((r) => r.id !== sourceRootId)] : live;
    const groups = [];
    for (const r of ordered) {
      const dev = await devOf(r.path);
      groups.push({
        rootId: r.id,
        rootName: rootInfo(r).name,
        sameVol: srcDev != null && dev != null && dev === srcDev,
        docs: linkIndex.query(r.id),
        others: await linkIndex.listNonDocFiles(r.path).catch(() => []),
      });
    }
    return groups;
  });
  // B：两根是否同一磁盘卷（stat().dev）。跨根建链（@菜单/拖拽）的同卷约束（plan §5）；拖拽路径用它（@菜单在 candidates-all 里已算）。
  ipcMain.handle('ws-same-volume', async (_e, aId, bId) => {
    const a = liveRoot(aId), b = liveRoot(bId);
    if (!a || !b) return false;
    try { const [sa, sb] = await Promise.all([fsp.stat(a.path), fsp.stat(b.path)]); return sa.dev === sb.dev; } catch { return false; }
  });
  ipcMain.handle('ws-links-backlinks', async (_e, rootId, rel) => { await ensureAllLinkIndexes(); return linkIndex.backlinks(rootId, rel); }); // A：fan-out 所有根（跨根反链）
  ipcMain.handle('ws-links-dir-backlinks', async (_e, rootId, dirRel) => { await ensureAllLinkIndexes(); return linkIndex.dirBacklinks(rootId, dirRel); }); // U6 删除守卫 + A 跨根夹外引用
  ipcMain.handle('ws-links-outlinks-count', async (_e, rootId, rel, isDir) => { await ensureLinkIndex(rootId); return linkIndex.ownOutlinks(rootId, rel, isDir); }); // U-CR0 跨根移动守卫：条目自身会断的出链数
  ipcMain.handle('ws-links-moved-target', async (_e, rootId, sourceRel, targetRel) => { await ensureLinkIndex(rootId); return linkIndex.movedTarget(rootId, sourceRel, targetRel); }); // U7 修复卡：断链目标靠 doc-id 反查现址
  ipcMain.handle('ws-links-rebuild', async (_e, rootId) => {
    await queueLink(rootId, async () => {
      const root = liveRoot(rootId);
      if (!root) return;
      await linkIndex.rebuildRoot(rootId, root.path); linkBuilt.add(rootId);
      broadcastLinksUpdated(rootId); scheduleLinkSave();
    });
    return { ok: true };
  });
  ipcMain.handle('read-doc', async (_e, p) => {
    assertDocPath(p);
    const buf = await files.readDocBuffer(p);
    const text = buf.toString('utf8');
    // 非 UTF-8 文件按 UTF-8 解码会丢字节，保存会损坏内容，直接拒开
    if (!Buffer.from(text, 'utf8').equals(buf)) {
      throw new Error('此文件不是 UTF-8 编码，为避免损坏内容，暂不支持编辑');
    }
    // markdown 后端：读盘处 md→html，下游（校验分流/编辑器/渲染）只见 HTML——格式只活在磁盘 IO 两端
    if (mdAdapter.isMdPath(p)) return mdAdapter.mdToHtml(text, { title: path.basename(p).replace(/\.md$/i, '') });
    return text;
  });
  ipcMain.handle('save-doc', async (_e, p, content) => {
    assertDocPath(p);
    // markdown 后端：先转换、再归档、再写盘——转换失败不产生任何副作用（审计整改：原顺序下反复失败的
    // 自动保存会把相同磁盘快照重复灌进历史、挤掉真历史版本）。转换产物为空（用户清空文档）写 '\n'：
    // writeDocSafe 拒空串（防误清空），一个换行 = 合法的空 md，否则清空后的 md 永远保存失败。
    let out = content;
    const isMd = mdAdapter.isMdPath(p);
    // 归档读原始字节（与文件编码无关）；U7 也用它读磁盘旧 doc-id（缺失才补、复用旧 id 不换）
    const prev = await files.readDocBuffer(p).catch(() => null);
    if (isMd) {
      out = await mdAdapter.htmlToMd(content);
      if (!out.trim()) out = '\n';
    } else {
      // U7 双层身份：html 主动保存时确保带 wordspace-doc-id（修复锚）。缺失才补、优先复用磁盘旧 id、绝不每次换。
      const diskId = prev !== null ? docIdLib.readDocId(prev.toString('utf8')) : null;
      out = docIdLib.ensureHtmlDocId(content, { id: diskId, gen: () => crypto.randomUUID() }).html;
    }
    let archiveWarning = null;
    if (prev !== null) {
      // 归档失败不能挡住保存：历史是安全网，保存本身优先
      await history.archive(historyRoot(), p, prev).catch(err => {
        archiveWarning = String((err && err.message) || err);
        console.error('history archive failed:', err);
      });
    }
    await files.writeDocSafe(p, out, { allowWhitespaceOnly: isMd }); // md 清空后 '\n' 也要能存（修 MD-1）
    docWatcher.noteSelfWrite(); // 写完才打戳：抑制窗口覆盖「写完→watcher 触发」的延迟，不被写入耗时吃掉（慢盘也不会自存盘误触发重载）
    return { ok: true, archiveWarning };
  });
  // 监听当前文档的外部磁盘变化（Bug2）：renderer 打开文档后调一次 watch-doc，文件被外部改动时
  // 主进程回一个 doc-changed，renderer 自行（按脏态）决定是否重载。换文档再调即重指向。
  ipcMain.on('watch-doc', (e, p) => {
    try { assertDocPath(p); } catch (err) { return; }
    docWatcher.watch(p, (changed) => {
      if (!e.sender.isDestroyed()) e.sender.send('doc-changed', changed);
    });
  });
  ipcMain.on('unwatch-doc', () => docWatcher.close());
  // 跨平台路径派生值（file:// URL / 目录URL / 文件名）在主进程算——完整 Node 的 url.pathToFileURL
  // 正确处理 Windows 盘符与反斜杠；renderer 不自己拼路径（沙箱 preload 没有可靠的 path/url）。
  ipcMain.handle('path-info', (_e, p) => { assertDocPath(p); return pathInfo(p); });
  // 导出 PDF（连续单页）：弹保存对话框选输出路径 → pdf-export 隐藏窗口印出来。
  // 有 html（Wordspace 所见即所得，UI 唯一路径）→ 印烤好的静态 HTML；无 html → 直印源文件
  // （只测试/内部用，不接 UI；也是「编辑器排版真烤进导出」e2e 的差分基线）。
  // WS2_PDF_OUT 是测试 seam：设了就跳过原生对话框直接用该路径（原生对话框 e2e 点不了）。
  ipcMain.handle('export-pdf', async (e, p, mode, html, opts) => {
    assertDocPath(p);
    // opts（分页文档）：paged=走标准 @page 分页（preferCSSPageSize）而非连续单页；pageNumbers=页脚页码。
    // 只取白名单字段成布尔（IPC 入参不可信，不原样透传对象）。
    const pdfOpts = { paged: !!(opts && opts.paged), pageNumbers: !!(opts && opts.pageNumbers) };
    // WS2_PDF_OUT 仅在非打包态生效（打包后忽略，一律走保存对话框）——跟 main.js 自动更新 isPackaged 闸一致，
    // 防生产进程继承到该环境变量就静默把 PDF 写到预设路径、绕过对话框。
    const seamPath = !app.isPackaged ? process.env.WS2_PDF_OUT : null;
    let outPath = seamPath;
    if (!outPath) {
      const def = path.basename(p).replace(/\.(html?|md)$/i, '') + '.pdf';
      const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: '导出 PDF',
        defaultPath: path.join(path.dirname(p), def),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      outPath = r.filePath;
    }
    try {
      if (mode === 'wordspace' && html) {
        // Wordspace 样式：renderer 已把「文档+编辑器排版」烤成静态 HTML，写到源文件同目录的临时文件
        // （相对资源原生解析），印完删。
        await exportPdfFromHtml(html, path.dirname(p), outPath, pdfOpts);
      } else {
        await exportPdf(p, outPath, pdfOpts); // 无 html：直印源文件（测试/内部用）
      }
      if (!seamPath) shell.showItemInFolder(outPath); // 成功：在 Finder 高亮文件（确认成功 + 告诉用户落在哪）；测试 seam 路径不弹
      return { ok: true, path: outPath };
    } catch (err) {
      console.error('export-pdf failed:', err);
      return { error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('ws-diag', () => perfDiag.snapshot()); // 诊断面板：每根 readTree 耗时/文件数/watcher 次数/云盘
  // 诊断面板「录制 Profile」：用 CDP 抓一段 renderer CPU profile（记录每个函数/每帧，不预判卡顿在哪 = catch-anything），
  // 存 .cpuprofile 到桌面 + 访达高亮，用户发回来我在 Chrome DevTools / speedscope 里看时间花在哪。DevTools 开着时会
  // 冲突（debugger 已被占）→ 返回 error，面板提示（打包版无 DevTools，正常工作）。
  ipcMain.handle('diag-record-profile', async (e, ms) => {
    const dbg = e.sender.debugger;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.start');
      await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(ms) || 5000, 1000), 30000)));
      const { profile } = await dbg.sendCommand('Profiler.stop');
      await dbg.sendCommand('Profiler.disable');
      dbg.detach();
      const file = path.join(app.getPath('desktop'), 'wordspace-profile-' + Date.now() + '.cpuprofile');
      await fsp.writeFile(file, JSON.stringify(profile));
      shell.showItemInFolder(file);
      return { path: file };
    } catch (err) {
      try { dbg.detach(); } catch {}
      return { error: err.message };
    }
  });
  ipcMain.handle('recents-list', () => recents.load(recentsFile()));
  ipcMain.handle('recents-add', (_e, p) => recents.add(recentsFile(), p));
  ipcMain.handle('history-list', (_e, p) => history.list(historyRoot(), p));
  // ⚠ .md 文档的归档是 md 原始字节（KD-7）：将来重接历史 UI 时，恢复进编辑器（loadFromHtml）前
  // 必须先过 mdAdapter.mdToHtml，否则会把裸 markdown 当 HTML 渲染、保存还会二次转义损坏内容。
  ipcMain.handle('history-read', (_e, p, id) => history.read(historyRoot(), p, id));

  // ---- 本地文件夹工作区 (F06 → 多根) ----
  // 添加文件夹（原 pick-folder）：选文件夹 → classifyRoot 嵌套智能判定 → 按关系分流。
  // WS2_FOLDER_IN 测试 seam（仅非打包态）：设了就跳过原生目录对话框（e2e 点不了原生对话框），
  // 照 WS2_PDF_OUT 先例；e2e 可经 electronApp.evaluate 改 process.env 换目标。
  ipcMain.handle('ws-add-folder', async () => {
    await restoreRoots(); // 空启动直接点添加时注册表也要先就位
    const seam = !app.isPackaged ? process.env.WS2_FOLDER_IN : null;
    let dir = seam;
    if (!dir) {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    const real = await canonReal(dir);
    const cls = rootsLib.classifyRoot(real, classifyRoots());
    if (cls.rel === 'same') {
      const r = roots.find((x) => x.id === cls.rootId);
      // 选的是一个失联根的路径且现在可达了（外置盘插回来）→ 顺手复活，不报「已打开」
      if (r.missing && (await dirExists(r.path))) {
        r.missing = false;
        r.real = await canonReal(r.path);
        startRootWatch(r);
        // 两段式（见 'added' 分支说明）：不带 tree，renderer 渲染加载态后走 wsReadTree 填。
        return { status: 'revived', root: rootInfo(r) };
      }
      return { status: 'same', root: rootInfo(r) };
    }
    if (cls.rel === 'child') {
      const parent = roots.find((x) => x.id === cls.parentId);
      return { status: 'child', name: path.basename(real), parent: rootInfo(parent) };
    }
    if (cls.rel === 'parent') {
      // 新根包住已有根 → 不静默动用户的树，出确认；确认走 ws-absorb-confirm(token)。
      // childIds 钉死在弹窗时刻：确认框列的是哪几个，吸收的就只能是哪几个（防挂起期间新加的根被连带吸收）。
      const children = cls.childIds.map((id) => roots.find((x) => x.id === id));
      const token = 'absorb-' + stashSeq++;
      pendingAbsorb.set(token, { path: path.resolve(dir), real, childIds: cls.childIds });
      if (pendingAbsorb.size > 8) pendingAbsorb.delete(pendingAbsorb.keys().next().value); // 取消不通知主进程，防囤积
      return { status: 'parent', token, name: path.basename(real), children: children.map(rootInfo) };
    }
    if (roots.length >= MAX_ROOTS) return { status: 'limit', max: MAX_ROOTS };
    const root = { id: 'r' + nextRootId++, path: path.resolve(dir), real, missing: false };
    roots.push(root);
    await persistRoots();
    startRootWatch(root);
    // 两段式返回：先回根（不带 tree），renderer 立刻渲染根 + 「正在读取…」加载行，再走 wsReadTree 填树。
    // 大文件夹（桌面/云盘）全量扫描 4-5s 阻塞在这条 IPC 回复上时，用户干等无反馈（Wendi 2026-07-14）。
    // watcher 已 startRootWatch 注册；加载期间（renderer 的 st.tree 仍为 null）watcher 事件被 doTreeScan
    // 的 `!st.tree` 守卫自然 no-op，不与第二段的 wsReadTree 打架。
    return { status: 'added', root: rootInfo(root) };
  });
  // 「并入并添加」确认：吸收子根（子根注销、标签 rebase 进新父根——文件都还在磁盘原处，只换归属）。
  ipcMain.handle('ws-absorb-confirm', async (_e, token) => {
    const pend = pendingAbsorb.get(token);
    pendingAbsorb.delete(token);
    if (!pend) return { status: 'stale' };
    // token 挂起期间注册表可能变了（并行又加了根/移除了根）→ 重新分类；不再是 parent、或子根集合
    // 跟弹窗时刻不一致（多了用户没确认过的根）都放弃，让用户重走确认。
    const cls = rootsLib.classifyRoot(pend.real, classifyRoots());
    if (cls.rel !== 'parent') return { status: 'stale' };
    const promised = new Set(pend.childIds);
    if (cls.childIds.length !== promised.size || !cls.childIds.every((id) => promised.has(id))) return { status: 'stale' };
    const newRoot = { id: 'r' + nextRootId++, path: pend.path, real: pend.real, missing: false };
    const rebases = [];
    for (const id of cls.childIds) {
      const child = roots.find((x) => x.id === id);
      // 前缀两侧统一用 realpath（对抗审查 MR-ADV-1）：classify 用 real 判定、前缀却拿字面 path 切会在
      // 软链形态不一致（/tmp vs /private/tmp）时算出空串/乱串 → 标签 rebase 到不存在的 rel、随后被
      // reconcile 静默清光。ownerOf 顺带做防御——真不在前缀下（理论到不了）返回 null 就整个放弃。
      const own = rootsLib.ownerOf(child.real || child.path, [{ id: 'p', path: pend.real }]);
      if (!own || !own.rel) return { status: 'stale' };
      rebases.push({ fromRootId: id, toRootId: newRoot.id, prefix: own.rel });
      workspaceWatcher.unwatch(id);
      dropLinkIndex(id); // U2（审查 #1）：被吸收的子根不再是根，丢它的链接索引（对齐 ws-remove-root）
    }
    roots = roots.filter((x) => !cls.childIds.includes(x.id));
    roots.push(newRoot); // 照 ui-demo：子根去掉、父根追加到末尾
    await persistRoots();
    // rebase 同步写进持久化（缩小两段式窗口）：renderer 崩在自己 rebase 之前，store 里根已换新、
    // 标签还挂旧 rootId → 下次启动全丢。主进程这里先把持久化标签 rebase 好，renderer 那份只是内存镜像。
    let storedTabs = await workspaceStore.getTabs(workspaceFile());
    for (const rb of rebases) storedTabs = tabsLib.rebaseRoot(storedTabs, rb.fromRootId, rb.toRootId, rb.prefix);
    await workspaceStore.setTabs(workspaceFile(), storedTabs);
    startRootWatch(newRoot);
    return { status: 'added', root: rootInfo(newRoot), tree: await workspace.readTree(newRoot.path), rebases };
  });
  // 移除根（磁盘文件不动）：注销 + 关 watcher；返回 token 供撤销原位放回。
  ipcMain.handle('ws-remove-root', async (_e, rootId) => {
    const idx = roots.findIndex((x) => x.id === rootId);
    if (idx < 0) return null;
    const [root] = roots.splice(idx, 1);
    workspaceWatcher.unwatch(rootId);
    dropLinkIndex(rootId); // U2：丢弃该根链接索引
    await persistRoots();
    const token = 'rmroot-' + stashSeq++;
    removedStash.set(token, { root, index: idx });
    if (removedStash.size > 20) removedStash.delete(removedStash.keys().next().value); // 防囤积
    return { token, root: rootInfo(root) };
  });
  ipcMain.handle('ws-undo-remove-root', async (_e, token) => {
    const st = removedStash.get(token);
    removedStash.delete(token);
    if (!st) return { status: 'stale' };
    // 撤销窗口期注册表可能变了：加了个跟它重叠的根 → 拒绝复活（嵌套禁令优先于撤销）；满员也拒。
    const cls = rootsLib.classifyRoot(st.root.real || st.root.path, classifyRoots());
    if (cls.rel !== 'independent') return { status: 'overlap' };
    if (roots.length >= MAX_ROOTS) return { status: 'limit', max: MAX_ROOTS };
    const root = { ...st.root, missing: !(await dirExists(st.root.path)) };
    const index = Math.min(st.index, roots.length);
    roots.splice(index, 0, root); // 放回原来的位置（照 ui-demo）
    await persistRoots();
    if (!root.missing) startRootWatch(root);
    return {
      status: 'ok',
      root: rootInfo(root),
      index,
      tree: root.missing ? null : await workspace.readTree(root.path),
    };
  });
  // 失联根重新定位：只对 missing 根开放；新路径不得与其他根重叠（嵌套禁令同 ws-add-folder）。
  // rootId 不变 → 标签/置顶身份（rootId:rel）原样复活。WS2_RELOCATE_IN 测试 seam 同 WS2_FOLDER_IN。
  ipcMain.handle('ws-relocate-root', async (_e, rootId) => {
    const r = roots.find((x) => x.id === rootId);
    if (!r || !r.missing) return null;
    const seam = !app.isPackaged ? process.env.WS2_RELOCATE_IN : null;
    let dir = seam;
    if (!dir) {
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '重新定位文件夹' });
      if (picked.canceled || !picked.filePaths[0]) return null;
      dir = picked.filePaths[0];
    }
    const real = await canonReal(dir);
    const others = classifyRoots().filter((x) => x.id !== rootId);
    const cls = rootsLib.classifyRoot(real, others);
    if (cls.rel !== 'independent') return { status: 'overlap' };
    r.path = path.resolve(dir);
    r.real = real;
    r.missing = false;
    dropLinkIndex(rootId); // U2（审查 #1）：路径变了，旧路径的索引作废 → 下次 query 从新路径懒建
    await persistRoots();
    startRootWatch(r);
    return { status: 'ok', root: rootInfo(r), tree: await workspace.readTree(r.path) };
  });
  // 根重排（拖拽/「移到最上面」）：renderer 只发 id 顺序；必须与注册表同集合才接受。
  ipcMain.handle('ws-reorder-roots', async (_e, ids) => {
    if (!Array.isArray(ids)) return null;
    const byId = new Map(roots.map((r) => [r.id, r]));
    if (ids.length !== roots.length || !ids.every((id) => byId.has(id))) return null;
    roots = ids.map((id) => byId.get(id));
    await persistRoots();
    return roots.map(rootInfo);
  });
  // 启动恢复：返回全部根（含失联的，renderer 渲染灰态），renderer 据此逐根读树。
  ipcMain.handle('ws-get-roots', async () => {
    await restoreRoots();
    return roots.map(rootInfo);
  });
  ipcMain.handle('ws-read-tree', async (_e, rootId) => {
    // 测试 seam（仅非打包态）：模拟真机大目录读树慢（逐文件 stat 取 inode），让「恢复工作区」确定性
    // 落后于冷启动 open-file，复现并守住「冷启动建标签」竞态——读树快的干净小工作区测不出这个 bug。
    const slow = !app.isPackaged ? +process.env.WS2_SLOW_TREE_MS || 0 : 0;
    if (slow) await new Promise((r) => setTimeout(r, slow));
    const r = roots.find((x) => x.id === rootId);
    if (!r || r.missing) return null;
    const tree = await workspace.readTree(r.path);
    // 读不出树且路径确实不可达 → 顺手转失联（watcher error 之外的第二个运行时判定点，如网络盘断连）
    if (!tree && !(await dirExists(r.path))) markRootMissing(r);
    return tree;
  });
  // 子树级重扫（watcher 报得出变化目录时的便宜路径）：只重扫受影响目录。返回 null = 让 renderer 回落全量
  // readTree（目录波及根层/参数不对/根失联）。dirs 由主进程 affectedDirsOf 产生，但按「渲染层传来的路径
  // 一律不可信」的既有威胁模型，readSubtrees 内部仍逐条 assertInsideWorkspace。
  ipcMain.handle('ws-read-subtrees', async (_e, rootId, dirs) => {
    const r = roots.find((x) => x.id === rootId);
    if (!r || r.missing) return null;
    if (!Array.isArray(dirs) || !dirs.length || dirs.length > 8 || dirs.some((d) => typeof d !== 'string' || !d)) return null;
    try {
      return await workspace.readSubtrees(r.path, dirs);
    } catch {
      return null; // 越权路径/瞬时 IO 错 → 回落全量，别把树搞半残
    }
  });
  // 聚焦兜底的便宜版：冲掉该根 watcher 的在途去抖（有变化立即走正常事件管线），返回 watcher 是否活着——
  // 不活（平台不支持递归 watch/挂了）的根，renderer 才需要聚焦全量刷新。
  ipcMain.handle('ws-watch-flush', (_e, rootId) => ({ alive: workspaceWatcher.flush(rootId) }));
  ipcMain.handle('ws-new-doc', (_e, rootId, dirRel, base, html, ext) =>
    workspace.newDoc(rootById(rootId), dirRel, base, html, ext),
  );
  // 「浏览…」把临时文档存到任意位置（可在工作区外）：主进程自己弹原生保存框、只写对话框返回的
  // 路径——renderer 不传 abs（信任模型同 pick-file：路径是用户当场在原生对话框亲手选的）。
  // WS2_SAVE_AS_OUT 是测试 seam：非打包态设了就跳过原生框直接用该路径（原生框 e2e 点不了，
  // 同 export-pdf 的 WS2_PDF_OUT；打包态忽略，防生产进程静默绕过对话框）。
  ipcMain.handle('ws-save-doc-as', async (e, base, html, ext, opts) => {
    // ext='md' 时写盘前 html→md。两个消费方：①另存为保持原格式（KD-6，md 文档存回 .md）；
    // ②「导出为 Markdown」（Colin+Wendi 2026-07-03）——合规 html 文档跨格式产 .md 副本，带 reveal。
    const isMd = ext === 'md';
    const leaf = (String(base || '').replace(/[\\/:*?"<>|]/g, ' ').trim() || '未命名') + (isMd ? '.md' : '.html');
    let out = !app.isPackaged ? process.env.WS2_SAVE_AS_OUT : null;
    const seamUsed = !!out;
    if (!out) {
      const firstLive = roots.find((r) => !r.missing);
      let defDir = firstLive ? firstLive.path : null;
      if (!defDir) { try { defDir = app.getPath('documents'); } catch { defDir = app.getPath('home'); } }
      const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: '保存文档',
        defaultPath: path.join(defDir, leaf),
        filters: isMd
          ? [{ name: 'Markdown 文档', extensions: ['md'] }]
          : [{ name: 'HTML 文档', extensions: ['html', 'htm'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      out = r.filePath;
    }
    if (isMd) { if (!/\.md$/i.test(out)) out += '.md'; }
    else if (!/\.html?$/i.test(out)) out += '.html';
    let content = html;
    if (isMd) {
      content = await mdAdapter.htmlToMd(html);
      if (!content.trim()) content = '\n'; // 同 save-doc：空产物写一个换行，不撞 writeDocSafe 的拒空守卫
    }
    await files.writeDocSafe(out, content, { allowWhitespaceOnly: isMd }); // 修 MD-1：md 空文档 '\n' 也要能存
    // 导出语义的调用方要 Finder 高亮产物（确认成功+落在哪，对齐 export-pdf）；测试 seam 路径不弹
    if (opts && opts.reveal && !seamUsed) shell.showItemInFolder(out);
    return { ok: true, abs: out };
  });
  ipcMain.handle('ws-make-dir', (_e, rootId, dirRel, name) => workspace.makeDir(rootById(rootId), dirRel, name));
  // rootId+rel → abs（U6 反链面板点来源文档 → openDoc 需要 abs；assertInsideWorkspace 防越权）。
  ipcMain.handle('ws-abs', (_e, rootId, rel) => assertInsideWorkspace(rootById(rootId), rel));
  // 改名/移动 + U5 自动重写引用：openAbs = 打开中的文档 abs（主进程重写时跳过它，renderer 内存改，免竞态）。
  ipcMain.handle('ws-rename', async (_e, rootId, relPath, newLeaf, openAbs) => {
    const root = rootById(rootId);
    const r = await workspace.renamePath(root, relPath, newLeaf);
    const rw = await rewriteAfterMove(root, rootId, relPath, r.rel, openAbs);
    return { ...r, ...rw };
  });
  ipcMain.handle('ws-move', async (_e, rootId, relPath, destDirRel, openAbs) => {
    const root = rootById(rootId);
    const r = await workspace.movePath(root, relPath, destDirRel);
    const rw = await rewriteAfterMove(root, rootId, relPath, r.rel, openAbs);
    return { ...r, ...rw };
  });
  // U5 外部改名/移动探测「一键更新」：rename 已在外部（Finder）发生，这里只按 moves 重写引用（不做 rename）。
  ipcMain.handle('ws-rewrite-moves', async (_e, rootId, movesArr, openAbs) => {
    const root = rootById(rootId);
    const j = (rel) => path.join(root, rel.split('/').join(path.sep));
    const movesAbs = new Map(); for (const [o, n] of movesArr) movesAbs.set(j(o), j(n)); // 外部改名探测给的是同根 rel 对 → 抬成 abs
    const { count, changedRootIds } = await rewriteRefsForMovesAbs(movesAbs, openAbs);
    changedRootIds.add(rootId);
    for (const id of changedRootIds) refreshLinkIndex(id);
    return { rewritten: count, moves: [...movesAbs] };
  });
  // 跨根移动（v1 便宜档）：同文件系统 rename 快路径成功即返回新 rel；真跨盘 EXDEV → 结构化 {crossDevice:true}
  // 让 renderer 出 toast（不做复制回退，Colin 2026-07-08 拍板）。其他错误（EACCES/ENOENT）原样抛，renderer 有 catch。
  // WS2_FORCE_EXDEV 测试 seam（仅非打包态，同 WS2_FOLDER_IN/WS2_PDF_OUT 先例）：真 tmp 造不出跨文件系统，
  // 设了就直接走 EXDEV 分支，e2e 才测得到 toast。打包态忽略（生产进程继承到也不改行为）。
  ipcMain.handle('ws-move-across', async (_e, fromRootId, relPath, toRootId, destDirRel, openAbs) => {
    const from = rootById(fromRootId); // 未注册/失联根抛错（树都不渲染、拖不出节点，正常到不了）
    const to = rootById(toRootId);
    if (!app.isPackaged && process.env.WS2_FORCE_EXDEV) return { crossDevice: true };
    try {
      const r = await workspace.movePathAcross(from, relPath, to, destDirRel);
      // C2：跨根移动后自动重写所有根里的引用（源根指向它的 href + 它自己指向源根兄弟的出链），返回 abs moves 给 renderer 改打开中文档。
      // from/to 是 rootById 返回的**路径字符串**（不是对象），直接当 fromDir/toDir 传。
      const rw = await rewriteAfterMoveAbs(from, fromRootId, relPath, to, toRootId, r.rel, openAbs);
      // 测试 seam（仅非打包）：落盘后、reply 前拖延，给 renderer 一个窗口触发 onTreeChanged——确定性复现
      // 「源根 watcher 抢在标签 retarget 之前 reconcile」的竞态，验证 crossMoveGuard 挡住误清（对抗审查 P2）。
      const slow = !app.isPackaged ? +process.env.WS2_SLOW_MOVE_MS || 0 : 0;
      if (slow) await new Promise((res) => setTimeout(res, slow));
      return { ...r, rewritten: rw.rewritten, moves: rw.moves };
    } catch (err) {
      if (err && err.code === 'EXDEV') return { crossDevice: true };
      throw err;
    }
  });
  ipcMain.handle('ws-delete', (_e, rootId, relPath) =>
    workspace.deletePath(rootById(rootId), relPath, trashRoot(), { trashItem: (p) => shell.trashItem(p) }),
  );
  ipcMain.handle('ws-undo-delete', (_e, rootId, token) =>
    workspace.undoDelete(rootById(rootId), token, trashRoot()),
  );
  // 标签/置顶状态（全局单一集合存进 workspace.json，重启恢复）。
  ipcMain.handle('ws-get-tabs', () => workspaceStore.getTabs(workspaceFile()));
  // 写盘前把「rootId 已不在注册表」的 rel entries 滤掉：persist 是 fire-and-forget，若移除根的动作
  // 和一次在飞的 persist 交错，盲写会把已移除根的标签复活进磁盘。失联(missing)根的 entries 保留——
  // 重新定位后要原样回来。
  ipcMain.handle('ws-set-tabs', (_e, state) => {
    const known = new Set(roots.map((r) => r.id));
    const entries = Array.isArray(state && state.entries)
      ? state.entries.filter((e) => !(e && typeof e.rel === 'string') || known.has(e.rootId))
      : [];
    return workspaceStore.setTabs(workspaceFile(), { entries, activeRel: state && state.activeRel });
  });
  // 某绝对路径是否还存在（给 loadTabs 重启恢复时校验外部标签的文件还在不在；不在则静默丢）。
  ipcMain.handle('path-exists', (_e, abs) => fsp.stat(abs).then(() => true, () => false));
  // 新建文档模板（含空文档，第一项）。
  ipcMain.handle('ws-templates', () => TEMPLATES);
  // 「AI 接入」弹窗的 Prompt 正文（打包进 app 的指南拷贝；防漂移测试锁它与 docs/ 正本逐字节一致）
  ipcMain.handle('ai-guide', () => fsp.readFile(path.join(__dirname, '..', 'renderer', 'ai-guide.md'), 'utf8'));
  // 非 .html 文件 → 系统默认程序打开（编辑器只认 html）。
  ipcMain.handle('ws-open-external', async (_e, rootId, relPath) => {
    const abs = assertInsideWorkspace(rootById(rootId), relPath);
    const err = await shell.openPath(abs); // 修 MP-6：失败 resolve 错误串，surface 给 renderer
    return err ? { error: err } : { ok: true };
  });
  // 根内任意文件的 file:// URL（给图片/PDF 内置查看器；assertInsideWorkspace 约束在根内防越权）。
  // pathInfo 那条只放 .html，这条放任意类型，所以单独开一个。
  ipcMain.handle('ws-file-url', (_e, rootId, relPath) => {
    const abs = assertInsideWorkspace(rootById(rootId), relPath);
    return pathToFileURL(abs).href;
  });

  // 浏览器 feature 的 IPC 面（webtab:*/bm:*/hist:*/browser-settings）。
  registerBrowserIpc();

  // 启动机会性清掉过期的删除备份。
  workspace.sweepBackups(trashRoot()).catch(() => {});
}

module.exports = { registerIpc };
