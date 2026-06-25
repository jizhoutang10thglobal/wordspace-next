const { ipcMain, dialog, app, BrowserWindow, shell } = require('electron');
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const files = require('./files');
const history = require('./history');
const recents = require('./recents');
const docWatcher = require('./doc-watcher');
const workspace = require('./workspace');
const workspaceStore = require('./workspace-store');
const { exportPdf, exportPdfFromHtml } = require('./pdf-export');
const { pathInfo } = require('../lib/path-url');
const { assertInsideWorkspace } = require('../lib/file-tree');
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
async function dirExists(p) {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// 纵深防御：读写只接受 .html/.htm 路径。app 本就只开 HTML（对话框/文件关联都限 .html），
// 这道守卫挡住「篡改 recents.json 注入 /etc/passwd 等任意路径越权读写」的向量，不影响正常流。
function assertHtmlPath(p) {
  if (typeof p !== 'string' || !/\.html?$/i.test(p)) throw new Error('只支持 .html/.htm 文件：' + p);
}

function registerIpc() {
  ipcMain.handle('pick-file', async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
      properties: ['openFile']
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('read-doc', async (_e, p) => {
    assertHtmlPath(p);
    const buf = await files.readDocBuffer(p);
    const text = buf.toString('utf8');
    // 非 UTF-8 文件按 UTF-8 解码会丢字节，保存会损坏内容，直接拒开
    if (!Buffer.from(text, 'utf8').equals(buf)) {
      throw new Error('此文件不是 UTF-8 编码，为避免损坏内容，暂不支持编辑');
    }
    return text;
  });
  ipcMain.handle('save-doc', async (_e, p, content) => {
    assertHtmlPath(p);
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
    await files.writeDocSafe(p, content);
    docWatcher.noteSelfWrite(); // 写完才打戳：抑制窗口覆盖「写完→watcher 触发」的延迟，不被写入耗时吃掉（慢盘也不会自存盘误触发重载）
    return { ok: true, archiveWarning };
  });
  // 监听当前文档的外部磁盘变化（Bug2）：renderer 打开文档后调一次 watch-doc，文件被外部改动时
  // 主进程回一个 doc-changed，renderer 自行（按脏态）决定是否重载。换文档再调即重指向。
  ipcMain.on('watch-doc', (e, p) => {
    try { assertHtmlPath(p); } catch (err) { return; }
    docWatcher.watch(p, (changed) => {
      if (!e.sender.isDestroyed()) e.sender.send('doc-changed', changed);
    });
  });
  ipcMain.on('unwatch-doc', () => docWatcher.close());
  // 跨平台路径派生值（file:// URL / 目录URL / 文件名）在主进程算——完整 Node 的 url.pathToFileURL
  // 正确处理 Windows 盘符与反斜杠；renderer 不自己拼路径（沙箱 preload 没有可靠的 path/url）。
  ipcMain.handle('path-info', (_e, p) => { assertHtmlPath(p); return pathInfo(p); });
  // 导出 PDF（连续单页，直印源文件）：弹保存对话框选输出路径 → pdf-export 隐藏窗口印出来。
  // WS2_PDF_OUT 是测试 seam：设了就跳过原生对话框直接用该路径（原生对话框 e2e 点不了）。
  ipcMain.handle('export-pdf', async (e, p, mode, html) => {
    assertHtmlPath(p);
    // WS2_PDF_OUT 仅在非打包态生效（打包后忽略，一律走保存对话框）——跟 main.js 自动更新 isPackaged 闸一致，
    // 防生产进程继承到该环境变量就静默把 PDF 写到预设路径、绕过对话框。
    const seamPath = !app.isPackaged ? process.env.WS2_PDF_OUT : null;
    let outPath = seamPath;
    if (!outPath) {
      const def = path.basename(p).replace(/\.html?$/i, '') + '.pdf';
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
        await exportPdf(p, outPath); // raw：直印源文件
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
    return workspace.readTree(activeRoot);
  });
  // 启动恢复：返回上次工作区根（仍存在才认），renderer 据此自动渲染。
  ipcMain.handle('ws-get-root', async () => {
    if (activeRoot) return activeRoot;
    const saved = await workspaceStore.load(workspaceFile());
    if (saved && (await dirExists(saved.root))) {
      activeRoot = path.resolve(saved.root);
      return activeRoot;
    }
    return null;
  });
  ipcMain.handle('ws-read-tree', () => (activeRoot ? workspace.readTree(activeRoot) : null));
  ipcMain.handle('ws-new-doc', (_e, dirRel, base, html) =>
    workspace.newDoc(requireRoot(), dirRel, base, html),
  );
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
  // 置顶常用文件（按当前工作区根存进 workspace.json，换工作区各自保留）。
  ipcMain.handle('ws-get-pins', () => workspaceStore.getPins(workspaceFile(), requireRoot()));
  ipcMain.handle('ws-set-pins', (_e, pins) =>
    workspaceStore.setPins(workspaceFile(), requireRoot(), pins),
  );
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
