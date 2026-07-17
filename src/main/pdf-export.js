const { BrowserWindow } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathInfo } = require('../lib/path-url');
const i18n = require('../lib/i18n');
const { isSelfPaged } = require('../lib/self-paged');

// 导出 PDF（MVP：直印源文件，文档自带 CSS，不注入编辑器样式）。
// 连续单页：页宽 = A4（210mm），页高 = 内容实际高度 → 零分页、所见即所得（不被纸张切断）。
// 隐藏窗口加载源文件 file://（不带工具栏/编辑器覆盖层），量内容高，printToPDF（单位=英寸，已 spike 实测）。
const A4_WIDTH_IN = 8.27;   // 210mm
const A4_WIDTH_PX = 794;    // 210mm @96dpi——隐藏窗口按这个宽排版，量出的高才与打印页宽一致
const A4_HEIGHT_PX = 1123;  // 空文档量不到内容高时的兜底视口高
const MAX_PAGE_IN = 199;    // Chromium printToPDF 单页上限约 200in（14400pt）；超了会被钳掉、底部丢内容

async function exportPdf(srcPath, outPath, exportOpts) {
  // 参数不叫 opts：下面非分页路径 try 块里有既有的 `const opts`（printToPDF 选项），同名会造成
  // 块级 TDZ 遮蔽（实踩：全量 e2e 6 个导出用例齐红 "Cannot access 'opts' before initialization"）。
  exportOpts = exportOpts || {};
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
    // 自带分页版式的文档（<style> 里有 @page / 强制分页符，如公函模板、Word 导出的 HTML）→ 视同
    // 分页文档走标准分页。不识别的话走连续单页会翻车：文档自己的 break-after:page 在 print 媒介下
    // 生效，把内容掰成 N 张「页高=全文高」的超长半空页 = 大白间隙（Wendi 2026-07-13 实报，
    // 她的 PDF MediaBox 实测 210mm×619.5mm）。读盘失败不抛——当不自分页，走原路径兜底。
    let selfPaged = false;
    if (!exportOpts.paged) {
      try { selfPaged = isSelfPaged(await fs.readFile(srcPath, 'utf8')); } catch (e) { /* 读不了按普通文档 */ }
    }
    // R8 恒浅色：nativeTheme.themeSource 是进程级的，导出隐藏窗口的 prefers-color-scheme 同样会翻暗——
    // 自带 @media (prefers-color-scheme: dark) 的野生文档（含自分页公函）可能把暗色排版印进 PDF。
    // 整条导出统一 debugger.attach + Emulation 强制 prefers-color-scheme:light，printToPDF 完成后才 detach
    // （两坑：①分页分支原本无 attach ②非分页分支原本量高后即 detach、早于 printToPDF，emulation 随 detach 复位）。
    wc.debugger.attach('1.3');
    try {
      // 分页文档：标准分页导出。纸张/方向/边距全由文档自带的 @page 决定（preferCSSPageSize），
      // 不量高、不走连续单页。强制 light（media 交给 printToPDF 的 print 渲染）。页码走 Chromium 页眉页脚模板。
      if (exportOpts.paged || selfPaged) {
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
        const popts = { printBackground: true, preferCSSPageSize: true };
        if (exportOpts.pageNumbers) {
          popts.displayHeaderFooter = true;
          popts.headerTemplate = '<span></span>'; // 必须给非空模板，否则 Chromium 印默认标题/日期
          popts.footerTemplate = '<div style="width:100%;text-align:center;font-size:9px;color:#777;font-family:-apple-system,sans-serif;">'
            + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>';
        }
        const pdfPaged = await wc.printToPDF(popts);
        await fs.writeFile(outPath, pdfPaged);
        return;
      }
      // 量内容总高（CSS px）：CDP Page.getLayoutMetrics——带外协议、不依赖页面 JS（我们关了 JS）。
      // CDP 失败直接抛错（外层 finally 销窗、handler 转成 {error} 弹给用户）——绝不静默退视口高。
      // 先切 print 媒介再量：printToPDF 在 print 媒介渲染，文档带 @media print 时 screen 量高会偏大。
      // media:'print' 与 prefers-color-scheme:light 必须并进同一次 setEmulatedMedia——该命令整体替换 emulation 状态。
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
        media: 'print',
        features: [{ name: 'prefers-color-scheme', value: 'light' }],
      });
      const m = await wc.debugger.sendCommand('Page.getLayoutMetrics');
      const sz = m.cssContentSize || m.contentSize;
      const h = sz && sz.height ? Math.ceil(sz.height) : A4_HEIGHT_PX; // 真量不到（空文档）→ 一个视口高，合理

      const heightIn = Math.max(h, 96) / 96; // px→in，下限 1in 防空文档 0 高
      const opts = { printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }; // 边距交给文档自身 padding
      if (heightIn <= MAX_PAGE_IN) {
        opts.pageSize = { width: A4_WIDTH_IN, height: heightIn }; // 连续单页：页高=内容高
      } else {
        // 太长撑不进单页（超 Chromium ~200in 上限会被钳掉、底部丢内容）→ 退标准 A4 分页，保证内容一段不丢。
        opts.pageSize = 'A4';
      }
      const pdf = await wc.printToPDF(opts);
      await fs.writeFile(outPath, pdf);
    } finally { try { wc.debugger.detach(); } catch (e) {} }
  } finally {
    win.destroy();
  }
}

// Wordspace 样式导出：renderer 给的静态打印 HTML（已含编辑器排版）写到源目录的临时 .html（相对资源原生解析），
// 复用 exportPdf 印出来，印完删。临时名 pid+时间戳+自增计数器防撞，dotfile 不打扰 doc-watcher（按 basename 过滤）。
let tmpSeq = 0;
async function exportPdfFromHtml(html, srcDir, outPath, opts) {
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
    throw new Error(i18n.t('dialog.errPdfTmpFail'));
  }
  try {
    await exportPdf(tmp, outPath, opts);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

module.exports = { exportPdf, exportPdfFromHtml };
