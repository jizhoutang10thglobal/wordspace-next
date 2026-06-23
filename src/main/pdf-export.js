const { BrowserWindow } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathInfo } = require('../lib/path-url');

// 导出 PDF（MVP：直印源文件，文档自带 CSS，不注入编辑器样式）。
// 连续单页：页宽 = A4（210mm），页高 = 内容实际高度 → 零分页、所见即所得（不被纸张切断）。
// 隐藏窗口加载源文件 file://（不带工具栏/编辑器覆盖层），量内容高，printToPDF（单位=英寸，已 spike 实测）。
const A4_WIDTH_IN = 8.27;   // 210mm
const A4_WIDTH_PX = 794;    // 210mm @96dpi——隐藏窗口按这个宽排版，量出的高才与打印页宽一致
const A4_HEIGHT_PX = 1123;  // 空文档量不到内容高时的兜底视口高
const MAX_PAGE_IN = 199;    // Chromium printToPDF 单页上限约 200in（14400pt）；超了会被钳掉、底部丢内容

async function exportPdf(srcPath, outPath) {
  const win = new BrowserWindow({
    show: false, width: A4_WIDTH_PX, height: A4_HEIGHT_PX,
    // javascript:false —— 跟编辑器一致：文档自带 <script> 不执行（编辑器里文档跑在无 allow-scripts 的
    // sandbox iframe 里也不执行），既是「所见即所得」一致性，也不在导出时运行不可信本地 HTML 的脚本。
    // 量高因此不能用 executeJavaScript（被这开关挡），改走 CDP（带外、不受影响）。
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await win.loadURL(pathInfo(srcPath).fileUrl); // 等 load（图片/资源就绪）后再量高
    const wc = win.webContents;
    // 量内容总高（CSS px）：CDP Page.getLayoutMetrics——带外协议、不依赖页面 JS（我们关了 JS）。
    // CDP 失败直接抛错（外层 finally 销窗、handler 转成 {error} 弹给用户）——绝不静默退视口高，
    // 那会把长文档截成一页却报成功 = 用户察觉不到的数据丢失。
    wc.debugger.attach('1.3');
    let h;
    try {
      const m = await wc.debugger.sendCommand('Page.getLayoutMetrics');
      const sz = m.cssContentSize || m.contentSize;
      h = sz && sz.height ? Math.ceil(sz.height) : A4_HEIGHT_PX; // 真量不到（空文档）→ 一个视口高，合理
    } finally { try { wc.debugger.detach(); } catch (e) {} }

    const heightIn = Math.max(h, 96) / 96; // px→in，下限 1in 防空文档 0 高
    const opts = { printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }; // 边距交给文档自身 padding（所见即所得）
    if (heightIn <= MAX_PAGE_IN) {
      opts.pageSize = { width: A4_WIDTH_IN, height: heightIn }; // 连续单页：页高=内容高
    } else {
      // 太长撑不进单页（超 Chromium ~200in 上限会被钳掉、底部丢内容）→ 退标准 A4 分页，保证内容一段不丢
      // （从「连续单页」降级成分页，是不丢内容的唯一选择）。
      opts.pageSize = 'A4';
    }
    const pdf = await wc.printToPDF(opts);
    await fs.writeFile(outPath, pdf);
  } finally {
    win.destroy();
  }
}

// Wordspace 样式导出：renderer 给的静态打印 HTML（已含编辑器排版）写到源目录的临时 .html（相对资源原生解析），
// 复用 exportPdf 印出来，印完删。临时名 pid+时间戳+自增计数器防撞，dotfile 不打扰 doc-watcher（按 basename 过滤）。
let tmpSeq = 0;
async function exportPdfFromHtml(html, srcDir, outPath) {
  // 先清掉源目录里历史残留的 .ws-export-*（正常流程会自删；残留只来自上次 SIGKILL/崩溃跳过了 finally）。
  // app 是单实例，不会有别的本实例并发占用同名 → 清理安全。
  try {
    const entries = await fs.readdir(srcDir);
    await Promise.all(entries.filter((f) => f.startsWith('.ws-export-')).map((f) => fs.unlink(path.join(srcDir, f)).catch(() => {})));
  } catch (e) { /* 读目录失败忽略 */ }
  const tmp = path.join(srcDir, '.ws-export-' + process.pid + '-' + Date.now() + '-' + (tmpSeq++) + '.html');
  try {
    await fs.writeFile(tmp, html, 'utf8');
  } catch (e) {
    throw new Error('无法在文档所在文件夹创建临时文件（可能是只读目录）。可改用「原 HTML 样式」导出。');
  }
  try {
    await exportPdf(tmp, outPath);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

module.exports = { exportPdf, exportPdfFromHtml };
