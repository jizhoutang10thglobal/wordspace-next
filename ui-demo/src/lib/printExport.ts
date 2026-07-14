// ============================================================================
// 分页文档的「导出 PDF」（demo 级）：把文档块序列化成干净 HTML，写进隐藏 iframe，
// 注入 @page 纸张/边距/页码 + print 样式后触发打印——浏览器打印预览就是所见即所得
// 的分页真验证（对齐真 app printToPDF + preferCSSPageSize 的语义）。
// ============================================================================

import type { Block, Doc } from '../types'
import { buildPrintCss, type PageConfig } from './page'

/** 单块 → 打印 HTML（与 Canvas 渲染的标签一一对应，样式走下面的 print 基线）。 */
function blockToHtml(b: Block): string {
  switch (b.type) {
    case 'heading': {
      const l = b.level ?? 2
      return `<h${l}>${b.html}</h${l}>`
    }
    case 'list': {
      const tag = b.listStyle === 'numbered' ? 'ol' : 'ul'
      const cls = b.listStyle === 'todo' ? ' class="ws-todo"' : ''
      return `<${tag}${cls}>${b.html}</${tag}>`
    }
    case 'quote':
      return `<blockquote>${b.html}</blockquote>`
    case 'callout':
      return `<div class="ws-callout">${b.html}</div>`
    case 'divider':
      return '<hr>'
    case 'image':
      // block.html 已是 canonical 形态（裸 <img> / <figure><img><figcaption>），原样输出；
      // 旧占位 stub（纯文本）没有图可打，跳过。
      return b.html.includes('<img') ? b.html : ''
    case 'table':
      // block.html 已是完整 <table>（内联样式），原样输出
      return b.html
    case 'code':
      // block.html 是若干 <div class="ws-code-line"> 行，包回 <pre>
      return `<pre class="ws-code">${b.html}</pre>`
    case 'embed':
      return `<div>${b.html}</div>`
    default:
      return `<p>${b.html}</p>`
  }
}

// 文档基线排版（对齐 Schema baseline 的气质：16px / 1.75），只服务打印。
const PRINT_BASE_CSS = `
  html, body { margin: 0; padding: 0; }
  body {
    font: 16px/1.75 -apple-system, "SF Pro Text", system-ui, "Segoe UI",
      "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #292524;
  }
  h1 { font-size: 2em; line-height: 1.3; margin: 1.2em 0 0.5em; }
  h2 { font-size: 1.5em; line-height: 1.3; margin: 1.1em 0 0.5em; }
  h3 { font-size: 1.2em; line-height: 1.3; margin: 1em 0 0.4em; }
  h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
  p { margin: 0.5em 0; }
  blockquote { margin: 0.8em 0; padding: 2px 0 2px 14px; border-left: 3px solid #d6d3d1; color: #57534e; }
  .ws-callout { margin: 0.8em 0; padding: 12px 14px; background: #f5f5f4; border-radius: 6px; }
  hr { border: none; border-top: 1px solid #e7e5e4; margin: 1.4em 0; }
  a { color: #1d6fbf; }
  img { max-width: 100%; height: auto; border-radius: 6px; break-inside: avoid; }
  figure { margin: 0.8em 0; break-inside: avoid; }
  figcaption { color: #78716c; font-size: 0.875em; text-align: center; margin-top: 6px; }
  h1, h2, h3 { break-after: avoid; }
  li, blockquote, .ws-callout { break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  tr { break-inside: avoid; }
  pre.ws-code {
    background: #f5f5f4; border: 1px solid #e4e6e9; border-radius: 6px;
    padding: 14px 16px; font-size: 12.5px; line-height: 1.6;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap; overflow-wrap: anywhere; margin: 0.8em 0;
  }
  .ws-code-line { min-height: 1.6em; }
`

/**
 * 打印导出：建隐藏 iframe → 写入文档 HTML + @page CSS → print()。
 * 打印对话框关闭后移除 iframe（afterprint + 兜底定时器）。
 */
export function printPagedDoc(doc: Doc, cfg: PageConfig): void {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  const idoc = iframe.contentDocument
  const iwin = iframe.contentWindow
  if (!idoc || !iwin) {
    iframe.remove()
    return
  }
  idoc.open()
  idoc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${doc.title.replace(/</g, '&lt;')}</title>` +
      `<style>${PRINT_BASE_CSS}\n${buildPrintCss(cfg)}</style></head><body>` +
      doc.blocks.map(blockToHtml).join('\n') +
      '</body></html>',
  )
  idoc.close()
  const cleanup = () => iframe.remove()
  iwin.addEventListener('afterprint', cleanup)
  // Safari 等不派发 afterprint 的兜底；打印预览是模态的，60s 足够
  window.setTimeout(cleanup, 60_000)
  // 等一帧让 iframe 完成排版再唤起打印
  window.setTimeout(() => {
    iwin.focus()
    iwin.print()
  }, 50)
}
