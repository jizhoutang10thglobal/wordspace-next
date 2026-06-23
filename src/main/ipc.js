const { ipcMain, dialog, app, BrowserWindow, shell } = require('electron');
const path = require('path');
const files = require('./files');
const history = require('./history');
const recents = require('./recents');
const docWatcher = require('./doc-watcher');
const { exportPdf, exportPdfFromHtml } = require('./pdf-export');
const { pathInfo } = require('../lib/path-url');

const historyRoot = () => path.join(app.getPath('userData'), 'history');
const recentsFile = () => path.join(app.getPath('userData'), 'recents.json');

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
  ipcMain.handle('recents-list', () => recents.load(recentsFile()));
  ipcMain.handle('recents-add', (_e, p) => recents.add(recentsFile(), p));
  ipcMain.handle('history-list', (_e, p) => history.list(historyRoot(), p));
  ipcMain.handle('history-read', (_e, p, id) => history.read(historyRoot(), p, id));
}

module.exports = { registerIpc };
