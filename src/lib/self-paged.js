// 检测「自带分页版式」的 HTML 文档——<style> 里声明了 @page，或 CSS/内联 style 里带强制分页符。
// 为什么需要：这类文档（公函模板、Word/WPS 导出的 HTML、自排 A4 纸面的 .page 布局）期望按
// 自己的纸张分页导出 PDF。走「连续单页」（页高=量出的内容高）会翻车：量高在 screen 媒介下做，
// printToPDF 却在 print 媒介下渲染，文档自己的 break-after:page 把内容掰成 N 张「页高=全文高」的
// 超长页，每张只有顶部一屏有内容、底下大片空白（Wendi 2026-07-13 实报：导出 PDF 出现大白间隙，
// MediaBox 实测 210mm×619.5mm=整个 screen 滚动高）。检测到 → 导出走标准分页（preferCSSPageSize，
// 纸张/边距交给文档自己的 @page），所见即所得。
//
// 检测面刻意收窄（防误伤普通文档被切成分页）：
// - @page 只认 <style> 块里的（正文里提到 "@page" 的教程类文档不触发）；
// - 强制分页符认 <style> 块 + 内联 style="" 属性（Word 导出惯用 <br style="page-break-before:always">）；
// - 只认「强制」值（page/always/left/right/recto/verso），break-inside / break-after:avoid|auto|column
//   这类排版微调不算分页版式（编辑器烤进打印 HTML 的 PAGED_PRINT_CSS 就带 break-inside:avoid）。
// 已知局限：外链 CSS（<link>）里的 @page 检测不到（本地野文档几乎都是内联 <style>，先不啃）。

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

// 强制分页符：现代（break-after/before: page|left|right|recto|verso）+ 传统（page-break-after/before: always|left|right）
const FORCED_BREAK = /(?:^|[;{\s'"])(?:break-(?:after|before)\s*:\s*(?:page|left|right|recto|verso)|page-break-(?:after|before)\s*:\s*(?:always|left|right))\b/i;
const AT_PAGE = /@page\b/;

function isSelfPaged(html) {
  if (!html || typeof html !== 'string') return false;
  let m;
  STYLE_BLOCK.lastIndex = 0;
  while ((m = STYLE_BLOCK.exec(html))) {
    const css = m[1].replace(CSS_COMMENT, '');
    if (AT_PAGE.test(css) || FORCED_BREAK.test(css)) return true;
  }
  STYLE_ATTR.lastIndex = 0;
  while ((m = STYLE_ATTR.exec(html))) {
    if (FORCED_BREAK.test(m[1] || m[2] || '')) return true;
  }
  return false;
}

module.exports = { isSelfPaged };
