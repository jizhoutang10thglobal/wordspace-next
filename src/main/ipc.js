const { ipcMain, dialog, app, BrowserWindow, shell } = require('electron');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const files = require('./files');
const history = require('./history');
const recents = require('./recents');
const docWatcher = require('./doc-watcher');
const workspaceWatcher = require('./workspace-watcher');
const workspace = require('./workspace');
const workspaceStore = require('./workspace-store');
const { exportPdf, exportPdfFromHtml } = require('./pdf-export');
const mdAdapter = require('./md-adapter');
const { pathInfo } = require('../lib/path-url');
const { assertInsideWorkspace, kindOf } = require('../lib/file-tree');
const { TEMPLATES } = require('../lib/doc-templates');

const historyRoot = () => path.join(app.getPath('userData'), 'history');
const recentsFile = () => path.join(app.getPath('userData'), 'recents.json');
const workspaceFile = () => path.join(app.getPath('userData'), 'workspace.json');
const trashRoot = () => path.join(app.getPath('userData'), '.ws2-trash');

// 当前工作区根：服务端唯一真相。pick-folder / ws-set-root 校验后设置；所有文件操作只收 relPath、
// 用这个根（渲染层不传根——防篡改 workspace.json 注入任意根越权）。
let activeRoot = null;
function requireRoot() {
  if (!activeRoot) throw new Error('没有打开的工作区');
  return activeRoot;
}
// 起对工作区根的递归监听：外部增删改 → 通知 renderer 重读树 + reconcile 标签。换根时重指向（watch 内部先 close）。
function startWorkspaceWatch(root) {
  workspaceWatcher.watch(root, () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.isDestroyed()) w.webContents.send('ws-tree-changed');
    }
  });
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
  // 给「打开」按钮选到的任意绝对路径分类：kind（按扩展名）+ 文件名 + 若在当前工作区内则算出 rel（否则 null）。
  // rel 用 realpath 归一化 root 与 abs 再 path.relative——macOS 上 /tmp→/private/tmp 这类软链会让原始 abs
  // 跟 path.join(root, rel) 算出的 abs 字符串对不上，不归一化的话「工作区内文件」也会被判成工作区外、建不出标签。
  ipcMain.handle('classify-file', async (_e, abs) => {
    const name = path.basename(abs);
    const kind = kindOf(name);
    let rel = null;
    if (activeRoot) {
      try {
        const real = await fsp.realpath(abs);
        const rootReal = await fsp.realpath(activeRoot);
        const r = path.relative(rootReal, real);
        if (r && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r)) {
          rel = r.split(path.sep).join('/'); // 统一成 / 分隔，跟文件树 rel 一致（Windows path.sep 是 \）
        }
      } catch { /* abs 不存在 / 无法 realpath：rel 留 null（当作工作区外处理） */ }
    }
    return { name, kind, rel };
  });
  // 工作区外文件（「打开」按钮自由选择）的 file:// URL / 默认程序打开。不经 assertInsideWorkspace：这些 abs
  // 不是 workspace-relative、也不来自可被篡改的 recents/workspace.json，而是用户当场在原生 showOpenDialog
  // 里亲手选的（可信来源）。仅服务「打开」按钮这一条 pick→view 流，别把这两个 IPC 接到其它入口。
  ipcMain.handle('file-url-abs', (_e, abs) => pathToFileURL(abs).href);
  ipcMain.handle('open-external-abs', async (_e, abs) => { await shell.openPath(abs); return { ok: true }; });
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
    // 归档读原始字节，与文件编码无关
    const prev = await files.readDocBuffer(p).catch(() => null);
    let archiveWarning = null;
    if (prev !== null) {
      // 归档失败不能挡住保存：历史是安全网，保存本身优先
      await history.archive(historyRoot(), p, prev).catch(err => {
        archiveWarning = String((err && err.message) || err);
        console.error('history archive failed:', err);
      });
    }
    // markdown 后端：写盘处 html→md（归档在上面读的是改动前磁盘 md 原始字节，顺序不受影响）
    const out = mdAdapter.isMdPath(p) ? await mdAdapter.htmlToMd(content) : content;
    await files.writeDocSafe(p, out);
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
  ipcMain.handle('export-pdf', async (e, p, mode, html) => {
    assertDocPath(p);
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
        await exportPdfFromHtml(html, path.dirname(p), outPath);
      } else {
        await exportPdf(p, outPath); // 无 html：直印源文件（测试/内部用）
      }
      if (!seamPath) shell.showItemInFolder(outPath); // 成功：在 Finder 高亮文件（确认成功 + 告诉用户落在哪）；测试 seam 路径不弹
      return { ok: true, path: outPath };
    } catch (err) {
      console.error('export-pdf failed:', err);
      return { error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('recents-list', () => recents.load(recentsFile()));
  ipcMain.handle('recents-add', (_e, p) => recents.add(recentsFile(), p));
  ipcMain.handle('history-list', (_e, p) => history.list(historyRoot(), p));
  ipcMain.handle('history-read', (_e, p, id) => history.read(historyRoot(), p, id));

  // ---- 本地文件夹工作区 (F06) ----
  // 选文件夹当工作区。WS2_FOLDER_IN 测试 seam（仅非打包态）：设了就跳过原生目录对话框
  // （e2e 点不了原生对话框），照 WS2_PDF_OUT 先例。
  ipcMain.handle('pick-folder', async () => {
    const seam = !app.isPackaged ? process.env.WS2_FOLDER_IN : null;
    let dir = seam;
    if (!dir) {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    activeRoot = path.resolve(dir);
    await workspaceStore.save(workspaceFile(), activeRoot);
    startWorkspaceWatch(activeRoot);
    return workspace.readTree(activeRoot);
  });
  // 启动恢复：返回上次工作区根（仍存在才认），renderer 据此自动渲染。
  ipcMain.handle('ws-get-root', async () => {
    if (activeRoot) return activeRoot;
    const saved = await workspaceStore.load(workspaceFile());
    if (saved && (await dirExists(saved.root))) {
      activeRoot = path.resolve(saved.root);
      startWorkspaceWatch(activeRoot);
      return activeRoot;
    }
    return null;
  });
  ipcMain.handle('ws-read-tree', async () => {
    // 测试 seam（仅非打包态）：模拟真机大目录读树慢（逐文件 stat 取 inode），让「恢复工作区」确定性
    // 落后于冷启动 open-file，复现并守住「冷启动建标签」竞态——读树快的干净小工作区测不出这个 bug。
    const slow = !app.isPackaged ? +process.env.WS2_SLOW_TREE_MS || 0 : 0;
    if (slow) await new Promise((r) => setTimeout(r, slow));
    return activeRoot ? workspace.readTree(activeRoot) : null;
  });
  ipcMain.handle('ws-new-doc', (_e, dirRel, base, html) =>
    workspace.newDoc(requireRoot(), dirRel, base, html),
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
      let defDir = activeRoot;
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
    await files.writeDocSafe(out, isMd ? await mdAdapter.htmlToMd(html) : html);
    // 导出语义的调用方要 Finder 高亮产物（确认成功+落在哪，对齐 export-pdf）；测试 seam 路径不弹
    if (opts && opts.reveal && !seamUsed) shell.showItemInFolder(out);
    return { ok: true, abs: out };
  });
  ipcMain.handle('ws-make-dir', (_e, dirRel, name) => workspace.makeDir(requireRoot(), dirRel, name));
  ipcMain.handle('ws-rename', (_e, relPath, newLeaf) =>
    workspace.renamePath(requireRoot(), relPath, newLeaf),
  );
  ipcMain.handle('ws-move', (_e, relPath, destDirRel) =>
    workspace.movePath(requireRoot(), relPath, destDirRel),
  );
  ipcMain.handle('ws-delete', (_e, relPath) =>
    workspace.deletePath(requireRoot(), relPath, trashRoot(), { trashItem: (p) => shell.trashItem(p) }),
  );
  ipcMain.handle('ws-undo-delete', (_e, token) =>
    workspace.undoDelete(requireRoot(), token, trashRoot()),
  );
  // 标签/置顶状态（按当前工作区根存进 workspace.json，换工作区各自保留、重启恢复）。
  ipcMain.handle('ws-get-tabs', () => workspaceStore.getTabs(workspaceFile(), requireRoot()));
  // renderer 传 root（它当时的 current.root）：persist 是 fire-and-forget，若 A 的写在用户已切到 B、
  // activeRoot 已变后才到达，盲信 requireRoot() 会把 A 的标签（含外部标签的绝对路径）写进 B 桶、在 B 里
  // 点开错文件。这里校验 root===activeRoot 不符就丢弃（也顺带硬化老的跨工作区竞态）。
  ipcMain.handle('ws-set-tabs', (_e, state, root) => {
    const active = requireRoot();
    if (root && path.resolve(root) !== active) return null;
    return workspaceStore.setTabs(workspaceFile(), active, state);
  });
  // 某绝对路径是否还存在（给 loadTabs 重启恢复时校验外部标签的文件还在不在；不在则静默丢）。
  ipcMain.handle('path-exists', (_e, abs) => fsp.stat(abs).then(() => true, () => false));
  // 新建文档模板（含空文档，第一项）。
  ipcMain.handle('ws-templates', () => TEMPLATES);
  // 非 .html 文件 → 系统默认程序打开（编辑器只认 html）。
  ipcMain.handle('ws-open-external', async (_e, relPath) => {
    const abs = assertInsideWorkspace(requireRoot(), relPath);
    await shell.openPath(abs);
    return { ok: true };
  });
  // 工作区内任意文件的 file:// URL（给图片/PDF 内置查看器；assertInsideWorkspace 约束在根内防越权）。
  // pathInfo 那条只放 .html，这条放任意类型，所以单独开一个。
  ipcMain.handle('ws-file-url', (_e, relPath) => {
    const abs = assertInsideWorkspace(requireRoot(), relPath);
    return pathToFileURL(abs).href;
  });

  // 启动机会性清掉过期的删除备份。
  workspace.sweepBackups(trashRoot()).catch(() => {});
}

module.exports = { registerIpc };
