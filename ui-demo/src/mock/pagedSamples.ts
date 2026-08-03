// ============================================================================
// 「分页测试」样例文档：给分页视图（块级分页 + 页间隙）准备的 edge-case 集。
// 全部默认不开分页——在文档右上 ⋯ →「页面设置…」里手动打开玩。
// 离线自足：图全是内联 SVG data URI，无外部请求。
// 每份文档测什么见各 doc 上方注释（也是给 Colin 的清单）。
// ============================================================================

import type { Block, Doc, FileEntry } from '../types'

const now = Date.now()
const HR = 60 * 60_000

// 内联 SVG 占位图（离线、可控高度）。A4 页内容高 ≈ 931px（普通边距），用它对着卡边界造块高。
function svgImg(w: number, h: number, fill: string, label: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect width='100%' height='100%' fill='${fill}'/>` +
    `<text x='50%' y='50%' fill='rgba(255,255,255,.85)' font-family='monospace' font-size='20' text-anchor='middle' dominant-baseline='middle'>${label} · ${w}×${h}</text>` +
    `</svg>`
  return `<img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" style="display:block;width:100%;height:auto;" alt="${label}">`
}

function docShell(id: string, title: string, emoji: string, blocks: Block[], ageH = 2): Doc {
  return {
    id,
    title,
    emoji,
    kind: 'doc',
    folderId: 'r-docs',
    visibility: 'private',
    localPath: `~/Documents/产品资料/分页测试/${title}.html`,
    updatedAt: now - ageH * HR, // 时间散开:让默认屏时间流(今天/昨天/本周/更早)有真分组可看
    updatedBy: 'm-wendi',
    collaborators: ['m-wendi'],
    blocks,
  }
}

const para = (id: string, html: string): Block => ({ id, type: 'text', html })
const h = (id: string, level: 1 | 2 | 3 | 4, html: string): Block => ({ id, type: 'heading', level, html })

// 1)「长文流水」——50+ 段普通段落,撑 4-5 页:基础块级分页(整段推页、页底留白、页码 chip)
const longFlow: Block[] = [h('lf-h', 1, '长文流水')]
for (let i = 1; i <= 54; i++) {
  longFlow.push(
    para(
      `lf-${i}`,
      `第 ${i} 段：这是分页测试的流水段落。块级分页的口径是——一个段落要么整段留在本页，要么整段推到下一页，永远不会被从中间劈开；页与页之间是真实的灰缝，页底有真实留白。这一段的长度大约两到三行，用来把文档自然撑过四页。`,
    ),
  )
}

// 2)「标题密集」——h1-h3 混排 + 段落:标题落页首/页尾的观感(标题被推页时应整块走)
const denseHeadings: Block[] = [h('dh-h', 1, '标题密集')]
for (let s = 1; s <= 14; s++) {
  denseHeadings.push(h(`dh-s${s}`, 2, `${s}. 二级标题：这一节标题很密`))
  denseHeadings.push(h(`dh-s${s}a`, 3, `${s}.1 三级标题`))
  denseHeadings.push(para(`dh-p${s}a`, `标题后面只跟一小段正文。测的是：标题恰好落在页尾时会不会孤零零挂在页底（屏显允许，但导出 PDF 有 break-after: avoid 兜着），以及标题被推到新页页首时上边距是否自然。`))
  denseHeadings.push(h(`dh-s${s}b`, 3, `${s}.2 又一个三级标题`))
  denseHeadings.push(h(`dh-s${s}c`, 4, `${s}.2.1 四级标题（国标靠字体区分层级）`))
  denseHeadings.push(para(`dh-p${s}b`, `短段。`))
}

// 3)「巨图轰炸」——多张不同高度大图,含一张超一页高(≈1100px>931px 页内高):测跨页超高块
const bigImages: Block[] = [
  h('bi-h', 1, '巨图轰炸'),
  para('bi-p1', '下面的图全是内联 SVG 色块（离线可用），高度从小到大，专门卡 A4 页内容高（约 931px）的边界。'),
  { id: 'bi-img1', type: 'embed', designed: true, html: svgImg(700, 300, '#4a7dbd', '中图') },
  para('bi-p2', '中图之后是一张 500px 的图——两张加起来放不下时，整图推下页，不许劈。'),
  { id: 'bi-img2', type: 'embed', designed: true, html: svgImg(700, 500, '#1e8e3e', '大图') },
  { id: 'bi-img3', type: 'embed', designed: true, html: svgImg(700, 880, '#b8541d', '接近一页高') },
  para('bi-p3', '上面那张接近一页高（880px），应该独占接近一整页。下面这张 1100px 超过一页内容高——按规则允许它跨页（起点从新页开始，纸面会被拉长，中间不切缝）。'),
  { id: 'bi-img4', type: 'embed', designed: true, html: svgImg(700, 1100, '#8a3ffc', '超一页高') },
  para('bi-p4', '超高图之后的这一段，应该从超高图结束处所在的页继续排，不会凭空多出一页。'),
  { id: 'bi-img5', type: 'embed', designed: true, html: svgImg(700, 200, '#0b8793', '小图收尾') },
]

// 4)「长表格」——40+ 行表(单块超页高,测跨页拉长纸面) + 短表对照
const rows: string[] = []
for (let i = 1; i <= 44; i++) {
  rows.push(
    `<tr><td style="border:1px solid #e4e6e9;padding:6px 10px;">${String(i).padStart(2, '0')}</td><td style="border:1px solid #e4e6e9;padding:6px 10px;">测试项 ${i}</td><td style="border:1px solid #e4e6e9;padding:6px 10px;">${i % 3 === 0 ? '通过' : i % 3 === 1 ? '待验证' : '进行中'}</td><td style="border:1px solid #e4e6e9;padding:6px 10px;">第 ${i} 行——表格是单个块，超过一页高时允许跨页拉长纸面</td></tr>`,
  )
}
const tableHtml = (body: string) =>
  `<table style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr><th style="border:1px solid #e4e6e9;padding:6px 10px;background:#f5f5f4;text-align:left;">#</th><th style="border:1px solid #e4e6e9;padding:6px 10px;background:#f5f5f4;text-align:left;">项目</th><th style="border:1px solid #e4e6e9;padding:6px 10px;background:#f5f5f4;text-align:left;">状态</th><th style="border:1px solid #e4e6e9;padding:6px 10px;background:#f5f5f4;text-align:left;">备注</th></tr></thead><tbody>${body}</tbody></table>`
const longTable: Block[] = [
  h('lt-h', 1, '长表格'),
  para('lt-p1', '先来一个短表（4 行）——单元格可点进去改文字，行尾按钮加/删行：'),
  { id: 'lt-t1', type: 'table', html: tableHtml(rows.slice(0, 4).join('')) },
  para('lt-p2', '下面是 44 行的长表——单块超一页高，按规则从新页起、允许跨页（纸面拉长，中间无缝）。导出 PDF 时浏览器会按行自然分页：'),
  { id: 'lt-t2', type: 'table', html: tableHtml(rows.join('')) },
  para('lt-p3', '长表之后的段落，从表格结束处所在页继续。'),
  { id: 'lt-t3', type: 'table', html: tableHtml(rows.slice(0, 6).join('')) },
]

// 5)「代码瀑布」——超长代码块(单块超页高) + 短代码块混排
const codeLines: string[] = []
for (let i = 1; i <= 90; i++) {
  codeLines.push(`// line ${String(i).padStart(2, '0')}: paginateBlocks 累计 y += h，放不下整块推下页`)
}
// 可编辑代码块的内容：每行一个 <div class="ws-code-line">（Phase 2 可对行加 margin 推挤）
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const codeInner = (lines: string[]) =>
  lines.map((l) => `<div class="ws-code-line">${esc(l)}</div>`).join('')
const codeFall: Block[] = [
  h('cf-h', 1, '代码瀑布'),
  para('cf-p1', '短代码块（8 行）——点某行可改文字，Enter 新增一行：'),
  { id: 'cf-c1', type: 'code', html: codeInner(codeLines.slice(0, 8)) },
  para('cf-p2', '90 行的超长代码块——单块超一页高，从新页起、跨页拉长纸面：'),
  { id: 'cf-c2', type: 'code', html: codeInner(codeLines) },
  para('cf-p3', '代码之后的正文接着排。再来一个中等的（20 行）：'),
  { id: 'cf-c3', type: 'code', html: codeInner(codeLines.slice(0, 20)) },
]

// 6)「混合大杂烩」——todo/callout/quote/嵌套列表/分隔线/图/表全混
const mixed: Block[] = [
  h('mx-h', 1, '混合大杂烩'),
  para('mx-p1', '所有块型混排，看真实文档形态下的分页观感。'),
  { id: 'mx-todo', type: 'list', listStyle: 'todo', html: '<li data-checked="true">已完成的待办</li><li data-checked="false">未完成的待办</li><li data-checked="false">第三条待办，稍微长一点，看看换行后块高的测量是否仍然准确</li>' },
  { id: 'mx-call', type: 'callout', html: '这是一个 callout。它有底色和内边距，块高比普通段落大，卡页尾时更容易被整块推页。' },
  { id: 'mx-quote', type: 'quote', html: '引用块：块级分页的语义是「块永不被劈开」——引用也一样，要么整段在本页，要么整段去下一页。' },
  h('mx-h2', 2, '各种列表'),
  { id: 'mx-list', type: 'list', html: '<li>无序列表第一条<ul><li>嵌套第二层<ul><li>嵌套第三层，列表整块是一个分页单元</li></ul></li></ul></li><li>无序列表第二条</li>' },
  { id: 'mx-num', type: 'list', listStyle: 'numbered', html: '<li>编号列表一</li><li>编号列表二</li><li>编号列表三</li>' },
  { id: 'mx-div', type: 'divider', html: '' },
  { id: 'mx-img', type: 'embed', designed: true, html: svgImg(700, 420, '#5a5f66', '杂烩中图') },
  { id: 'mx-t', type: 'table', html: tableHtml(rows.slice(0, 5).join('')) },
  h('mx-h3', 2, '结尾'),
  para('mx-p2', '结尾段落。块级分页处的页尾留白 + 灰缝 + 新页上边距应与自然分页完全同款。'),
]

// 8)「一句话」——只有一句话:单页短文档也要显示一张完整 A4 纸
const oneLiner: Block[] = [para('ol-p', '这份文档只有这一句话——开分页后它也应该是一张完整的 A4 纸，纸高不缩水。')]

// 9)「超长不可断行」——超长 URL/连续无空格字符:测溢出不顶破纸宽
const noBreak: Block[] = [
  h('nb-h', 1, '超长不可断行'),
  para('nb-p1', '超长 URL：https://wordspace.ai/docs/pagination/very/deep/path/segment-one/segment-two/segment-three/segment-four/segment-five?query=块级分页&mode=paged&paper=A4&orientation=portrait&margin=normal&pageNumbers=true#anchor-position-in-a-very-long-fragment-identifier'),
  para('nb-p2', '连续无空格字符：Pneumonoultramicroscopicsilicovolcanoconiosis_Donaudampfschifffahrtsgesellschaftskapitaenswitwe_supercalifragilisticexpialidocious_0123456789012345678901234567890123456789'),
  para('nb-p3', `行内代码不可断：<code>paginateBlocks(blockHeights,pageContentH,breakAfter)===>{pageOfBlock,gapBefore,pageCount,pageStartBlocks,lastFill,trailingGap}</code>`),
  para('nb-p4', '正常段落收尾：上面的长串不应把纸面横向顶破（纸宽固定 = 纸张物理宽度），最多在块内换行或滚动。'),
]

// 10)「深嵌套列表」——5+ 层嵌套列表撑长:嵌套列表整块是一个分页单元
const nest = (depth: number, i: number): string =>
  depth === 0
    ? `<li>叶子项 ${i}</li>`
    : `<li>第 ${6 - depth} 层第 ${i} 项<ul>${nest(depth - 1, 1)}${nest(depth - 1, 2)}</ul></li>`
const deepList: Block[] = [
  h('dl-h', 1, '深嵌套列表'),
  para('dl-p1', '下面每个列表块都嵌到第 5-6 层。注意：一个 list 块（含全部嵌套）是一个分页单元，块高超一页时按超高块跨页。'),
  { id: 'dl-l1', type: 'list', html: `${nest(5, 1)}${nest(5, 2)}` },
  para('dl-p2', '中间隔一段。再来一个：'),
  { id: 'dl-l2', type: 'list', html: `${nest(4, 1)}${nest(4, 2)}${nest(4, 3)}` },
  para('dl-p3', '收尾段落。'),
]

export const PAGED_SAMPLE_DOCS: Doc[] = [
  docShell('d-pg-longflow', '长文流水', '📜', longFlow, 30),
  docShell('d-pg-headings', '标题密集', '🪜', denseHeadings, 52),
  docShell('d-pg-bigimg', '巨图轰炸', '🖼️', bigImages, 76),
  docShell('d-pg-table', '长表格', '📊', longTable, 100),
  docShell('d-pg-code', '代码瀑布', '💻', codeFall, 130),
  docShell('d-pg-mixed', '混合大杂烩', '🥘', mixed, 170),
  docShell('d-pg-oneline', '一句话', '🫧', oneLiner, 200),
  docShell('d-pg-nobreak', '超长不可断行', '🧵', noBreak, 250),
  docShell('d-pg-deeplist', '深嵌套列表', '🪆', deepList, 300),
]

export const PAGED_SAMPLE_FILES: FileEntry[] = PAGED_SAMPLE_DOCS.map((d) => ({
  rootId: 'r-docs',
  path: `分页测试/${d.title}.html`,
  kind: 'html',
  docId: d.id,
}))
