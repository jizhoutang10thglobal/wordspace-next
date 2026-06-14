const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const files = require('./files');
const history = require('./history');
const recents = require('./recents');
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
    return { ok: true, archiveWarning };
  });
  // 跨平台路径派生值（file:// URL / 目录URL / 文件名）在主进程算——完整 Node 的 url.pathToFileURL
  // 正确处理 Windows 盘符与反斜杠；renderer 不自己拼路径（沙箱 preload 没有可靠的 path/url）。
  ipcMain.handle('path-info', (_e, p) => { assertHtmlPath(p); return pathInfo(p); });
  ipcMain.handle('recents-list', () => recents.load(recentsFile()));
  ipcMain.handle('recents-add', (_e, p) => recents.add(recentsFile(), p));
  ipcMain.handle('history-list', (_e, p) => history.list(historyRoot(), p));
  ipcMain.handle('history-read', (_e, p, id) => history.read(historyRoot(), p, id));
}

module.exports = { registerIpc };
