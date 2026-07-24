import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronRight, GripVertical, MoreHorizontal } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI, anyOverlayOpen } from '../mock/ui'
import { IS_MAC } from '../lib/platform'
import { useT, t as tImperative, type TFunc } from '../i18n'
import { scopeTemplateCss } from '../lib/templateScope'
import {
  VISIBILITY_META,
  type Block,
  type BlockType,
  type Doc,
  type ListStyle,
} from '../types'
import { Avatar, VisibilityDot } from '../ui/primitives'
import { relTime } from '../lib/format'
import DocMenu from './canvas/DocMenu'
import FormatToolbar, { type FormatRect } from './canvas/FormatToolbar'
import AiSoonModal from './canvas/AiSoonModal'
import BlockActionMenu from './canvas/BlockActionMenu'
import SlashMenu from './canvas/SlashMenu'
import MentionMenu, { type MentionItem } from './canvas/MentionMenu'
import LinkPreview from './canvas/LinkPreview'
import Backlinks from './canvas/Backlinks'
import DocFind from './canvas/DocFind'
import { resolveHref, relHref, dirOf, baseOf, splitHrefSuffix } from '../lib/links'
import {
  acceptsImageType,
  imageBlockHtml,
  ingestImage,
  parseImageBlockHtml,
  pickImageFiles,
} from '../lib/image'
import { usePageConfig } from '../mock/paged'
import { useDocTypography, applyPreset, useTypography } from '../mock/typography'
import { buildTypographyCss } from '../lib/typography'
import { PAGE_GAP_PX, computeInnerSplits, paginateBlocks, pageBoxPx } from '../lib/page'
import { getDragFile } from './ArcSidebar'
import type { FileEntry } from '../types'
import './Canvas.css'

const EDITABLE: BlockType[] = ['heading', 'text', 'list', 'quote', 'callout', 'table', 'code']
const isEditable = (b: Block) => !b.designed && EDITABLE.includes(b.type)
// 表格 / 代码是「原生编辑」块：单元格 / 代码行是 contentEditable，Enter/Backspace/方向键/Tab
// 一律交给浏览器原生（新行、合行、行内导航），块编辑器的结构性快捷键（新建块、并块、跨块导航、
// 斜杠、@提及）在这类块里全部让路。
const isRawEditBlock = (b: Block | undefined) =>
  !!b && (b.type === 'table' || b.type === 'code' || b.type === 'toggle')

// 斜杠 `/` 插入菜单的条目（插入块 / 转换块 / AI）。kw 供拼音/英文筛选。
const SLASH_ITEMS: {
  key: string
  label: string
  kw: string
  type: BlockType | 'ai' | 'doclink'
  level?: 1 | 2 | 3 | 4
  listStyle?: ListStyle
}[] = [
  { key: 'text', label: 'editor.text', kw: 'text zhengwen p', type: 'text' },
  { key: 'h1', label: 'editor.heading1', kw: 'h1 biaoti heading', type: 'heading', level: 1 },
  { key: 'h2', label: 'editor.heading2', kw: 'h2 biaoti heading', type: 'heading', level: 2 },
  { key: 'h3', label: 'editor.heading3', kw: 'h3 biaoti heading', type: 'heading', level: 3 },
  { key: 'h4', label: 'editor.heading4', kw: 'h4 biaoti heading', type: 'heading', level: 4 },
  { key: 'list', label: 'editor.bulletedList', kw: 'list liebiao ul bulleted wuxu', type: 'list', listStyle: 'bulleted' },
  { key: 'numbered', label: 'editor.numberedList', kw: 'numbered ordered ol bianhao youxu 1', type: 'list', listStyle: 'numbered' },
  { key: 'todo', label: 'editor.todoList', kw: 'todo task checkbox daiban checklist', type: 'list', listStyle: 'todo' },
  // 互链的可发现入口①：斜杠菜单。位置放在列表之后（第 8 项）——放最后会掉出菜单可视区、
  // 用户根本看不见（Colin 实测「没找到」的直接原因）。历史注释说「下标引用只能 append」已核实过时：
  // 全仓只有 .filter / .find(key)，无下标引用，重排安全。
  { key: 'doclink', label: 'editor.slashDoclink', kw: 'link doclink lianjie wendang mention at @', type: 'doclink' },
  { key: 'quote', label: 'editor.quote', kw: 'quote yinyong', type: 'quote' },
  { key: 'callout', label: 'editor.callout', kw: 'callout tishi', type: 'callout' },
  { key: 'table', label: 'editor.table', kw: 'table biaoge grid', type: 'table' },
  { key: 'code', label: 'editor.code', kw: 'code daima pre snippet', type: 'code' },
  { key: 'toggle', label: 'editor.toggle', kw: 'toggle zhedie collapse details expand shouqi zhankai', type: 'toggle' },
  { key: 'image', label: 'editor.image', kw: 'image img tupian picture photo zhaopian', type: 'image' },
  { key: 'divider', label: 'editor.divider', kw: 'divider hr fengexian', type: 'divider' },
  { key: 'ai', label: 'editor.slashAi', kw: 'ai', type: 'ai' },
]
// label 现在是 i18n key，筛选时用 t(label) 求出当前语言文案再匹配（kw 仍是拼音/英文关键字）。
const filterSlash = (q: string, t: TFunc) => {
  const s = q.toLowerCase()
  return SLASH_ITEMS.filter(
    (it) => !s || t(it.label).toLowerCase().includes(s) || it.kw.includes(s),
  )
}

// 行首 markdown 前缀 → 目标块类型。仅当块内容正好是「前缀 + 一个空格」时触发
// （用户在空行敲前缀+空格的瞬间），避免误转已有正文。
function detectMarkdown(
  text: string,
): { type: BlockType; level?: 1 | 2 | 3 | 4; listStyle?: ListStyle } | null {
  const m = text.match(/^(#{1,4}|[-*]|1\.|\[\s?\]|>)[\s ]$/)
  if (!m) return null
  const t = m[1]
  if (t[0] === '#') return { type: 'heading', level: t.length as 1 | 2 | 3 | 4 }
  if (t === '-' || t === '*') return { type: 'list', listStyle: 'bulleted' }
  if (t === '1.') return { type: 'list', listStyle: 'numbered' }
  if (t[0] === '[') return { type: 'list', listStyle: 'todo' }
  return { type: 'quote' }
}

// 列表 html → 段落内联 html（转块时保内容）：各 <li> 拆开用 <br> 连接。
const unwrapListHtml = (html: string): string => {
  const items = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi)
  return items
    ? items.map((li) => li.replace(/<\/?li[^>]*>/gi, '')).join('<br>')
    : html.replace(/<\/?li[^>]*>/gi, '')
}

// caret 前 n 个字符（识别 '[['/'【【' 提及触发用）：块起点 → caret 的文本取尾 n 位
function textBeforeCaret(el: HTMLElement, n: number): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return ''
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return ''
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return pre.toString().slice(-n)
}
// 插入互链 <a> 时的转义（title/href 来自用户输入/文件名）
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// 当前 caret 的视口坐标（菜单锚点）。选区折叠时 getClientRects 可能为空 → 退父元素盒。
function caretRectViewport(): { top: number; left: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0).cloneRange()
  const rects = r.getClientRects()
  const rect = rects.length ? rects[0] : r.startContainer.parentElement?.getBoundingClientRect()
  if (!rect) return null
  return { top: rect.bottom + 6, left: rect.left }
}

// 点击落点 → caret Range（Chrome/Safari/Edge: caretRangeFromPoint；Firefox: caretPositionFromPoint）
function caretRangeAtPoint(x: number, y: number): Range | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  }
  if (d.caretRangeFromPoint) return d.caretRangeFromPoint(x, y)
  const pos = d.caretPositionFromPoint?.(x, y)
  if (pos) {
    const r = document.createRange()
    r.setStart(pos.offsetNode, pos.offset)
    r.collapse(true)
    return r
  }
  return null
}

// caret 是否在块内容末尾（之后无非空白文本）。用 Range 比较，避免内联标签下 textContent 长度误判。
function isCaretAtBlockEnd(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const caret = sel.getRangeAt(0)
  if (!el.contains(caret.endContainer)) return false
  const after = document.createRange()
  after.setStart(caret.endContainer, caret.endOffset)
  after.setEnd(el, el.childNodes.length)
  return after.toString().trim() === ''
}

// caret 是否在块内容最前端（之前无任何文本）。用于 Backspace 删/合并到上一块。
function isCaretAtBlockStart(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const caret = sel.getRangeAt(0)
  if (!el.contains(caret.startContainer)) return false
  const before = document.createRange()
  before.setStart(el, 0)
  before.setEnd(caret.startContainer, caret.startOffset)
  return before.toString() === ''
}

// ---------------------------------------------------------------------------
// One block. 单击可编辑块 = 进文字编辑（光标落点击处）；单击不可编辑块 = 块级灰选中。
// 「分块制」只留在数据层（每块离散、忠实 HTML），不再在视觉上做对象框。
// ---------------------------------------------------------------------------
// 图片块（doc-images spec）：原子叶子块——光标不可入内、点击=整块灰选（走 BlockRow 的
// onSelect 路径）。block.html 只有两种 canonical 形态（imageBlockHtml 构造）：裸 <img> /
// <figure><img><figcaption>。说明（figcaption）是块内唯一可编辑区，点击它不触发块选中；
// 清空失焦即降回裸 <img>（双向收敛）。
function ImageBlockView({
  doc,
  block,
  selected,
  registerEl,
}: {
  doc: Doc
  block: Block
  selected: boolean
  registerEl: (id: string, el: HTMLElement | null) => void
}) {
  const t = useT()
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const checkpoint = useStore((s) => s.checkpoint)
  const parsed = useMemo(() => parseImageBlockHtml(block.html), [block.html])
  const [capOpen, setCapOpen] = useState(false) // 「加说明」刚点开、caption 还是空的编辑态
  const capRef = useRef<HTMLElement | null>(null)

  if (!parsed) {
    // 旧占位块 / 坏数据：沿用原灰盒占位渲染，不假装是图
    return (
      <div className="ws-image ws-image-stub" ref={(el) => registerEl(block.id, el)}>
        {block.html || t('editor.image')}
      </div>
    )
  }
  const persistCaption = () => {
    const text = (capRef.current?.textContent ?? '').trim()
    if (text !== parsed.caption) {
      checkpoint()
      updateBlockHtml(doc.id, block.id, imageBlockHtml(parsed.src, parsed.alt, text))
    }
    setCapOpen(false)
  }
  const showCaption = capOpen || parsed.caption !== ''
  return (
    <figure
      className="ws-image"
      data-block={block.id}
      ref={(el) => registerEl(block.id, el)}
    >
      <img src={parsed.src} alt={parsed.alt} draggable={false} />
      {showCaption && (
        <figcaption
          ref={(el) => {
            capRef.current = el
          }}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={t('editor.captionPlaceholder')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation() // 别让 Enter/Backspace 漏到文档级快捷键（会插块/删块）
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault()
              ;(e.target as HTMLElement).blur()
            }
          }}
          onBlur={persistCaption}
        >
          {parsed.caption}
        </figcaption>
      )}
      {selected && !showCaption && (
        <button
          type="button"
          className="ws-image-addcap"
          contentEditable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setCapOpen(true)
            window.setTimeout(() => capRef.current?.focus(), 0)
          }}
        >
          {t('editor.addCaption')}
        </button>
      )}
    </figure>
  )
}

// ---------------------------------------------------------------------------
// 折叠块（toggle · Schema #1 <details>）：UX 外壳。summary = 可编辑标题行；body = 单一
// 原始 HTML contentEditable 区（有意分歧 KTD3：ui-demo 不做真嵌套块，body 是一整块 raw HTML；
// 真嵌套只在真 app 承载）。两区各自 stopPropagation（照 figcaption），Enter/Backspace 到不了
// 文档级快捷键。折叠靠自绘 chevron（纸方墨圆）驱动 setBlockOpen——native disclosure 被 summary
// onClick 的 preventDefault 掐掉（open 受 block.open 控），点 summary 文字只落光标、绝不折叠。
function parseToggleHtml(html: string): { summary: string; body: string } {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const details = tmp.querySelector('details')
  if (!details) return { summary: '', body: html }
  const summaryEl = details.querySelector('summary')
  const summary = summaryEl ? summaryEl.innerHTML : ''
  const clone = details.cloneNode(true) as HTMLElement
  clone.querySelector('summary')?.remove()
  return { summary, body: clone.innerHTML }
}

function ToggleBlockView({
  doc,
  block,
  registerEl,
}: {
  doc: Doc
  block: Block
  registerEl: (id: string, el: HTMLElement | null) => void
}) {
  const t = useT()
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const setBlockOpen = useStore((s) => s.setBlockOpen)
  const checkpoint = useStore((s) => s.checkpoint)
  const parsed = useMemo(() => parseToggleHtml(block.html), [block.html])
  const sumRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLElement | null>(null)
  const sumFocused = useRef(false)
  const bodyFocused = useRef(false)

  const open = block.open ?? true

  // 未聚焦时把 store 内容同步进各区（聚焦时不动，避免和光标打架）——照 BlockRow.setNode。
  const setSum = useCallback(
    (el: HTMLElement | null) => {
      sumRef.current = el
      if (el && !sumFocused.current && el.innerHTML !== parsed.summary)
        el.innerHTML = parsed.summary
    },
    [parsed.summary],
  )
  const setBody = useCallback(
    (el: HTMLElement | null) => {
      bodyRef.current = el
      if (el && !bodyFocused.current && el.innerHTML !== parsed.body)
        el.innerHTML = parsed.body
    },
    [parsed.body],
  )
  useLayoutEffect(() => {
    if (sumRef.current && !sumFocused.current && sumRef.current.innerHTML !== parsed.summary)
      sumRef.current.innerHTML = parsed.summary
    if (bodyRef.current && !bodyFocused.current && bodyRef.current.innerHTML !== parsed.body)
      bodyRef.current.innerHTML = parsed.body
  }, [parsed.summary, parsed.body])

  // 任一区失焦：读两区活内容重建 block.html（summary + body），变了才 checkpoint+写回。
  // 折叠态（open）不进 html——由 block.open 单独持有，打印时强制展开（printExport）。
  const persist = () => {
    const summary = sumRef.current?.innerHTML ?? parsed.summary
    const body = bodyRef.current?.innerHTML ?? parsed.body
    const html = `<details><summary>${summary}</summary>${body}</details>`
    if (html !== block.html) {
      checkpoint()
      updateBlockHtml(doc.id, block.id, html)
    }
  }
  const onSumBlur = () => {
    sumFocused.current = false
    persist()
  }
  const onBodyBlur = () => {
    bodyFocused.current = false
    persist()
  }
  const onSummaryKey = (e: React.KeyboardEvent) => {
    e.stopPropagation() // 别让 Enter/Backspace 漏到文档级快捷键（会插块/删块）
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault() // summary 单行：Enter 不换行、不折叠，直接提交失焦
      ;(e.target as HTMLElement).blur()
    }
  }

  return (
    <details
      className="ws-toggle"
      open={open}
      data-block={block.id}
      ref={(el) => registerEl(block.id, el)}
    >
      <summary
        className="ws-toggle-summary"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // 掐掉 native disclosure（open 受 block.open 控）+ 阻止块级灰选；点文字只落光标不折叠。
          e.stopPropagation()
          e.preventDefault()
        }}
      >
        <button
          type="button"
          className="ws-toggle-chevron"
          contentEditable={false}
          aria-label={open ? t('editor.toggleCollapse') : t('editor.toggleExpand')}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setBlockOpen(doc.id, block.id, !open)
          }}
        >
          <ChevronRight size={16} strokeWidth={2.2} />
        </button>
        <span
          className="ws-toggle-summary-text"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          data-placeholder={t('editor.newToggleSummary')}
          ref={setSum}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={onSummaryKey}
          onFocus={() => {
            sumFocused.current = true
          }}
          onBlur={onSumBlur}
        />
      </summary>
      <div
        className="ws-toggle-body"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={t('editor.newToggleBody')}
        ref={setBody}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onFocus={() => {
          bodyFocused.current = true
        }}
        onBlur={onBodyBlur}
      />
    </details>
  )
}

// ---------------------------------------------------------------------------
function BlockRow({
  doc,
  block,
  index,
  registerEl,
  selected,
  editing,
  onSelect,
  onEdit,
  onMarkdown,
  onFocusBlock,
  onOpenBlockMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dropEdge,
}: {
  doc: Doc
  block: Block
  index: number
  registerEl: (id: string, el: HTMLElement | null) => void
  selected: boolean
  editing: boolean
  onSelect: (id: string) => void
  onEdit: (id: string, x: number, y: number) => void
  onMarkdown: (id: string) => void
  onFocusBlock: (id: string | null) => void
  onOpenBlockMenu: (id: string, pos: { top: number; left: number }) => void
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
  onDragEnd: () => void
  dropEdge: 'top' | 'bottom' | null
}) {
  const t = useT()
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const checkpoint = useStore((s) => s.checkpoint)
  const elRef = useRef<HTMLElement | null>(null)
  const debounce = useRef<number | undefined>(undefined)
  const focused = useRef(false)
  const edited = useRef(false) // 本次编辑会话是否已快照（撤销粒度=一次编辑会话一步）

  const canEdit = isEditable(block)
  const editableNow = canEdit && editing

  // 仅在未聚焦时从 store 同步内容，避免和光标打架（覆盖 AI 改版 / 重排复用等外部 mutation）
  const setNode = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el
      registerEl(block.id, el)
      if (el && !focused.current && el.innerHTML !== block.html) {
        el.innerHTML = block.html
      }
    },
    [block.id, block.html, registerEl],
  )

  useLayoutEffect(() => {
    const el = elRef.current
    if (el && !focused.current && el.innerHTML !== block.html) {
      el.innerHTML = block.html
    }
  }, [block.html])

  const persist = () => {
    const el = elRef.current
    // strip-on-persist：块内推挤（表格间隔行 / li·代码行 marginTop）绝不进文档字节。
    if (el) updateBlockHtml(doc.id, block.id, serializeClean(el))
  }
  const handleInput = () => {
    if (!edited.current) {
      checkpoint() // 本次编辑会话首个输入 → 快照，撤销回到编辑前
      edited.current = true
    }
    onMarkdown(block.id) // 行首 markdown 前缀触发（即时，不等 debounce）
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(persist, 400)
  }
  const handleBlur = () => {
    focused.current = false
    edited.current = false
    window.clearTimeout(debounce.current)
    persist()
  }
  const handleFocus = () => {
    focused.current = true
    onFocusBlock(block.id)
  }

  // 代码块输入：把 contentEditable 里新产生的直接子元素统一标成 .ws-code-line（浏览器 Enter
  // 默认插入无 class 的 <div>），保证「每行 = 一个块级元素」结构稳定（Phase 2 按行推挤要用）。
  // 只加 class、不重排 DOM，光标安全。
  const normalizeCodeLines = () => {
    const el = elRef.current
    if (!el) return
    for (const child of Array.from(el.children)) {
      if (child.tagName === 'DIV' && !child.classList.contains('ws-code-line')) {
        child.classList.add('ws-code-line')
      }
    }
  }
  const handleCodeInput = () => {
    normalizeCodeLines()
    handleInput()
  }

  // 表格加/删行（demo 级）：直接改 elRef 里的 <table> DOM 再回写 html。
  // 加一行：克隆末行的单元格结构（保内联样式）、清空文字后追加。
  const addTableRow = () => {
    const el = elRef.current
    const tbody = el?.querySelector('tbody')
    if (!el || !tbody) return
    checkpoint()
    // 跳过间隔行（.ws-page-spacer 是运行时视觉产物、不算数据行）取末行做结构样板。
    const dataRows = Array.from(tbody.querySelectorAll('tr')).filter(
      (r) => !r.classList.contains('ws-page-spacer'),
    )
    const last = dataRows[dataRows.length - 1] ?? null
    const tr = document.createElement('tr')
    const cells = last ? Array.from(last.children) : []
    const n = cells.length || 1
    for (let i = 0; i < n; i++) {
      const td = document.createElement('td')
      td.setAttribute('style', cells[i]?.getAttribute('style') || '')
      td.innerHTML = '<br>'
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
    persist()
  }
  // 删除此行：删光标所在的 tbody 行；取不到 / 不在表内则删末行。至少保留一行。
  const deleteTableRow = () => {
    const el = elRef.current
    const tbody = el?.querySelector('tbody')
    if (!el || !tbody) return
    // 只数/删数据行——间隔行不参与行计数与光标导航。
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(
      (r) => !r.classList.contains('ws-page-spacer'),
    )
    if (rows.length <= 1) return
    let target: Element | null = null
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      const n = sel.getRangeAt(0).startContainer
      const en = n.nodeType === 1 ? (n as Element) : n.parentElement
      const tr = en?.closest('tr')
      if (tr && tbody.contains(tr) && !tr.classList.contains('ws-page-spacer')) target = tr
    }
    if (!target) target = rows[rows.length - 1]
    checkpoint()
    target.remove()
    persist()
  }

  const editProps = {
    ref: setNode as never,
    contentEditable: editableNow,
    suppressContentEditableWarning: true,
    spellCheck: false,
    onInput: handleInput,
    onBlur: handleBlur,
    onFocus: handleFocus,
    'data-block': block.id,
  }

  let inner: React.ReactNode
  if (block.designed || block.type === 'embed') {
    inner = (
      <div
        className="ws-embed"
        ref={(el) => registerEl(block.id, el)}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    )
  } else if (block.type === 'divider') {
    inner = <hr className="ws-hr" ref={(el) => registerEl(block.id, el)} />
  } else if (block.type === 'image') {
    inner = (
      <ImageBlockView doc={doc} block={block} selected={selected} registerEl={registerEl} />
    )
  } else if (block.type === 'toggle') {
    inner = <ToggleBlockView doc={doc} block={block} registerEl={registerEl} />
  } else if (block.type === 'heading') {
    const L = `h${block.level ?? 2}` as 'h1' | 'h2' | 'h3' | 'h4'
    inner = <L className={`ws-h ws-h${block.level ?? 2}`} {...editProps} />
  } else if (block.type === 'text') {
    inner = (
      <p className="ws-p" data-placeholder={t('editor.textPlaceholder')} {...editProps} />
    )
  } else if (block.type === 'list') {
    const style = block.listStyle ?? 'bulleted'
    const Tag = (style === 'numbered' ? 'ol' : 'ul') as 'ul' | 'ol'
    const cls =
      'ws-ul' +
      (style === 'numbered' ? ' ws-ol' : '') +
      (style === 'todo' ? ' ws-todo' : '')
    // 待办：点 <li> 左侧勾选框区（clientX 在内容左缘之外）切 data-checked，不放光标。
    const onToggleCheck = (e: React.MouseEvent) => {
      if (style !== 'todo') return
      const li = (e.target as HTMLElement).closest?.('li') as HTMLElement | null
      if (!li || !elRef.current?.contains(li)) return
      if (e.clientX >= li.getBoundingClientRect().left) return // 点在文字上 → 正常编辑
      e.preventDefault()
      checkpoint()
      li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true'
      persist()
    }
    inner = <Tag className={cls} {...editProps} onMouseDown={onToggleCheck} />
  } else if (block.type === 'table') {
    // 可编辑表格：wrapper div 为 contentEditable 根，block.html 是完整 <table>，
    // 单元格（td/th）随 contentEditable 一起可编辑；加/删行按钮仅编辑态出现。
    inner = (
      <div className="ws-table-block">
        <div className="ws-table" {...editProps} />
        {editableNow && (
          <div className="ws-table-tools" contentEditable={false}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addTableRow}
            >
              {t('editor.addRow')}
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={deleteTableRow}
            >
              {t('editor.deleteRow')}
            </button>
          </div>
        )}
      </div>
    )
  } else if (block.type === 'code') {
    // 可编辑代码：<pre> 为 contentEditable 根，block.html 是若干 <div class="ws-code-line">。
    // 每行独立块级元素（Enter 新增、Backspace 合行走浏览器原生），输入后归一化行 class。
    inner = (
      <pre className="ws-code" {...editProps} onInput={handleCodeInput} />
    )
  } else if (block.type === 'quote') {
    inner = <blockquote className="ws-quote" {...editProps} />
  } else {
    inner = <div className="ws-callout" {...editProps} />
  }

  return (
    <div
      className={
        `ws-block${canEdit ? '' : ' ws-block-static'}` +
        ` ws-blk-${
          block.type === 'heading' ? `h${block.level ?? 2}` : block.type
        }` +
        `${selected ? ' ws-block-selected' : ''}` +
        `${editing ? ' ws-block-editing' : ''}` +
        `${dropEdge ? ` ws-block-drop-${dropEdge}` : ''}`
      }
      onClick={(e) => {
        e.stopPropagation()
        if (canEdit) onEdit(block.id, e.clientX, e.clientY)
        else onSelect(block.id)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver(index)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
    >
      <div className="ws-block-controls" contentEditable={false}>
        <span
          className="ws-block-grip"
          title={t('editor.blockGripTitle')}
          draggable
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onOpenBlockMenu(block.id, { top: r.bottom + 4, left: r.left })
          }}
          onDragStart={() => onDragStart(index)}
          onDragEnd={onDragEnd}
        >
          <GripVertical size={15} strokeWidth={1.8} />
        </span>
      </div>

      {inner}
    </div>
  )
}

// 序列化 strip-on-persist（V4）：分页推挤是运行时视觉产物（li/代码行的 paddingTop、表格的
// ws-page-spacer 间隔行），绝不能进文档数据。序列化前 clone 一份剥干净再取 innerHTML。
// 这也兜住 contenteditable 回车分裂继承出来的推挤克隆（persist 可能先于下一帧 recalc 扫荡发生）。
function serializeClean(el: HTMLElement): string {
  if (!el.querySelector('.ws-page-spacer, [data-ws-pushed]')) return el.innerHTML
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.ws-page-spacer').forEach((n) => n.remove())
  clone.querySelectorAll<HTMLElement>('[data-ws-pushed]').forEach((n) => {
    n.style.paddingTop = ''
    n.removeAttribute('data-ws-pushed')
    if (!n.getAttribute('style')) n.removeAttribute('style')
  })
  return clone.innerHTML
}

// 超高块的切分候选原子（V4）：干净几何下采集（调用方保证已扫荡掉一切推挤痕迹）。
// 列表=li（含嵌套；父 li 与首子 li 同顶时去重保留外层，整棵子树一起推）、代码=.ws-code-line、
// 表格=tr（跳过 spacer）、其余块级后代兜底。top 为相对块顶的干净坐标。
type CutAtom = { top: number; kind: 'el' | 'tr'; el: HTMLElement }
function collectCutAtoms(host: HTMLElement): CutAtom[] {
  const base = host.getBoundingClientRect().top
  const atoms: CutAtom[] = []
  host
    .querySelectorAll<HTMLElement>('li, p, blockquote, figure, hr, h1, h2, h3, h4, details, .ws-code-line')
    .forEach((e) => {
      if (e.closest('table')) return
      if (e.closest('pre') && !e.classList.contains('ws-code-line')) return
      // 折叠 <details> 的隐藏后代不参与切分（display:none、几何为 0）。用 parentElement.closest
      // 而非 e.closest——后者含自身、会把折叠 details 本身也排掉；我们要保留它的 summary 高度原子。
      if (e.parentElement && e.parentElement.closest('details:not([open])')) return
      atoms.push({ top: e.getBoundingClientRect().top - base, kind: 'el', el: e })
    })
  host.querySelectorAll<HTMLElement>('tr').forEach((e) => {
    if (e.classList.contains('ws-page-spacer')) return
    atoms.push({ top: e.getBoundingClientRect().top - base, kind: 'tr', el: e })
  })
  atoms.sort((a, b) => a.top - b.top)
  const out: CutAtom[] = []
  for (const a of atoms) if (!out.length || a.top - out[out.length - 1].top > 1) out.push(a)
  return out
}

// ---------------------------------------------------------------------------
// 页间隙 spacer（仅屏显视觉，不进文档数据、不可编辑）：
// 上段 = 当前页剩余留白 fill + 页底边距（白，纸面自然收尾）；
// 中段 = 页间灰缝（负 margin 盖过纸边框，把整条白纸切成一页页，内含「第 N 页」chip）；
// 下段 = 下一页顶边距（白）。
// ---------------------------------------------------------------------------
function PageGap({
  fill,
  nextPage,
  box,
  onClick,
}: {
  fill: number
  nextPage: number // 1-based 下一页页码（chip 文案）
  box: ReturnType<typeof pageBoxPx>
  onClick?: (e: React.MouseEvent) => void // 点页底留白/页间空白 → 路由光标到最近块（修死区）
}) {
  const t = useT()
  return (
    <div
      className="ws-page-gap"
      contentEditable={false}
      aria-hidden
      onClick={onClick}
      style={{
        height: fill + box.margin.bottom + PAGE_GAP_PX + box.margin.top,
      }}
    >
      <div
        className="ws-page-gutter"
        style={{
          height: PAGE_GAP_PX,
          marginTop: fill + box.margin.bottom,
          marginLeft: -(box.margin.left + 1),
          marginRight: -(box.margin.right + 1),
        }}
      >
        <span className="ws-page-chip">{t('editor.pageN', { n: nextPage })}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header: breadcrumb, meta, and the "…" menu (export / link / rename / delete)
// ---------------------------------------------------------------------------
export function DocHeader({ doc }: { doc: Doc }) {
  const t = useT()
  const editor = useStore((s) => s.getMember(doc.updatedBy))
  const renameDoc = useStore((s) => s.renameDoc)
  // 反链面板要的当前文件身份（rootId + 根内路径）。选字符串（不选对象）避免每次 store 更新都重渲。
  const blRootId = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.fileName ? t.rootId : undefined
  })
  const blPath = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.fileName && t.rootId ? t.url : undefined
  })
  // 面包屑：连接文件夹里的文档（文件标签页带 rootId）→ 根名 / 路径；未保存的临时文档 / 网页 → null。
  const folderCrumb = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    if (!t?.rootId) return null
    const root = s.roots.find((r) => r.id === t.rootId)
    const mount = root?.name ?? ''
    return t.url ? `${mount} / ${t.url}` : mount
  })
  const isFolderSpace = folderCrumb !== null
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(doc.title)
  const v = VISIBILITY_META[doc.visibility]

  const commitRename = () => {
    const t = draft.trim()
    if (t && t !== doc.title) renameDoc(doc.id, t)
    setRenaming(false)
  }

  return (
    <div className="ws-doc-header">
      <div className="ws-breadcrumb">
        {folderCrumb ? (
          <span className="ws-truncate">{folderCrumb}</span>
        ) : (
          <span>{doc.unsaved ? t('editor.unsavedDraft') : t('editor.docFallback')}</span>
        )}
        <div className="ws-doc-more">
          <button
            className="ws-icon-btn"
            title={t('common.more')}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MoreHorizontal size={16} strokeWidth={1.8} />
          </button>
          {menuOpen && (
            <DocMenu
              doc={doc}
              onClose={() => setMenuOpen(false)}
              onRename={() => {
                setDraft(doc.title)
                setRenaming(true)
              }}
            />
          )}
        </div>
      </div>

      {renaming ? (
        <input
          className="ws-rename-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : null}

      <div className="ws-doc-meta">
        {editor && <Avatar member={editor} size={20} />}
        <span className="ws-muted">
          {t('editor.editedBy', { name: editor?.name ?? '', time: relTime(doc.updatedAt) })}
        </span>
        {!isFolderSpace && (
          <span className="ws-meta-vis">
            <VisibilityDot v={doc.visibility} />
            {v.label}
          </span>
        )}
      </div>
      {/* 反向链接（互链）：Notion 式标题区折叠计数。app chrome、不进文档字节。 */}
      {blRootId && blPath && <Backlinks rootId={blRootId} path={blPath} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
// docId：编辑指定文档而非当前激活 tab（给 Schema 演示页内嵌真编辑器用）。
// embedded：内嵌模式——去掉文档头（面包屑/标题/发布）和页脚，只留可编辑的块 + 全套编辑 UX。
export default function Canvas({ docId, embedded }: { docId?: string; embedded?: boolean } = {}) {
  const t = useT()
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const getDoc = useStore((s) => s.getDoc)
  const addBlock = useStore((s) => s.addBlock)
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const reorderBlocks = useStore((s) => s.reorderBlocks)
  const deleteBlock = useStore((s) => s.deleteBlock)
  const setBlockType = useStore((s) => s.setBlockType)
  const duplicateBlock = useStore((s) => s.duplicateBlock)
  const checkpoint = useStore((s) => s.checkpoint)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  // 互链要的 store 面
  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)
  const openFileTab = useStore((s) => s.openFileTab)
  const openWebTab = useStore((s) => s.openWebTab)
  const createLinkedDoc = useStore((s) => s.createLinkedDoc)
  const toast = useStore((s) => s.toast)

  const tab = tabs.find((x) => x.id === activeTabId)
  const doc = docId ? getDoc(docId) : tab?.docId ? getDoc(tab.docId) : undefined
  // 当前文档的文件身份（相对链接的解析基准）。未保存草稿/云端文档没有路径 → 互链功能不开。
  // docId prop / embedded（Schema 演示页内嵌编辑器）也不开：那时 activeTab 指的是别的文档，
  // 用它做解析基准整套错位（对抗审查抓到的潜伏坑）。
  const linkingOn = !docId && !embedded
  const curRootId = linkingOn && tab?.fileName ? tab.rootId : undefined
  const curPath = linkingOn && tab?.fileName && tab.rootId ? tab.url : undefined

  // ===== 分页文档（块级分页 + 真实页间隙 spacer）=====
  const pageCfg = usePageConfig(doc?.id)
  const paged = !!doc && pageCfg.on
  const pageBox = useMemo(() => pageBoxPx(pageCfg), [pageCfg])
  // 标准化排版层（U3/KTD6）：per-doc 排版配置 → scoped CSS 注入 article（.ws-doc-paged .ws-p{…}
  // 类级特异性盖过 base 硬编字号/行距）。typographyCss 变 → 重算依赖触发重排（下方 recalc effect）。
  const typoDoc = useDocTypography(doc?.id)
  const typographyCss = useMemo(() => (paged ? buildTypographyCss(typoDoc.config) : ''), [paged, typoDoc])
  // 测试 seam（绑当前文档）：U5 工具栏未建前，Playwright 门经此施加排版；与真 app 的 __ws2DocSchema 探针同路子。
  useEffect(() => {
    if (typeof window === 'undefined' || !doc) return
    ;(window as unknown as { __ws2Typo?: unknown }).__ws2Typo = {
      docId: doc.id,
      applyPreset: (pid: string) => applyPreset(doc.id, pid),
      setSizePt: (pt: number) => {
        const cur = useTypography.getState().getDoc(doc.id).config
        useTypography.getState().setConfig(doc.id, { ...cur, body: { ...cur.body, sizePt: pt } })
      },
    }
  }, [doc])
  const articleRef = useRef<HTMLElement | null>(null)
  // gaps[i] = 块 i 前的块级页间隙（null = 不切页，流内 PageGap spacer 真实推挤给出上下页边距）；
  // gutters = 超高块「跨页续排」时画在内容上的页界分隔线（top 相对纸 padding 盒、实测块顶算出，
  //           覆盖层绝对定位、pointer-events:none 不吃点击、不改内容 DOM）；
  // tailFill = 末页尾部补白（把末页补成整张纸）。
  const [pag, setPag] = useState<{
    gaps: ({ fill: number; nextPage: number } | null)[]
    gutters: { top: number; fill: number; page: number }[]
    tailFill: number
    pageCount: number
  } | null>(null)

  const docFindOpen = useUI((s) => s.docFindOpen)
  const closeDocFind = useUI((s) => s.closeDocFind)

  // 模板版式：文档已盖章的 templateCss（从模板新建 / 存为模板带来）经 templateScope
  // 作用域化后注入，只作用文档区、不漏 app 界面。
  const scopedTplCss = useMemo(() => scopeTemplateCss(doc?.templateCss ?? ''), [doc?.templateCss])

  const scrollRef = useRef<HTMLDivElement>(null)
  const blockEls = useRef<Map<string, HTMLElement>>(new Map())
  const focusedBlockId = useRef<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)

  // 分页重算（V4「带留白的块内分页」）：内容/窗口变化（ResizeObserver）→ rAF 合帧 → recalc。
  // 块与块之间靠流内 PageGap spacer 给出真实上下页边距（正常分页主力，一直稳）；
  // 超高块（单块高 > 页内容高）在块内切分点「真推内容」——li/代码行加 paddingTop、表格插 spacer 行，
  // 推挤量 = 切点上方剩余留白 + 页底边距 + 灰缝 + 页顶边距 → 每个页界都是 Word 式实体留白、每页恰一张纸。
  // 两条铁则（Phase 2 巨隙翻车换来的）：
  //  ① 清理走「选择器全量扫荡」：contenteditable 回车会把带推挤样式的元素一分为二，克隆继承
  //     style/data-ws-pushed 却不在任何记录里——按引用清理永远漏掉它们、padding 越积越大（巨隙根因）。
  //     每轮 recalc 先从整篇纸面扫掉所有推挤痕迹，回到干净几何再测量、再按新计划重推。
  //  ② 灰缝锚定「实测推挤位置」：推完立刻量锚点元素的真实位置，缝画在腾出的空档里——内容在哪缝在哪，
  //     结构上不可能 desync（绝不用纯几何网格反过来要求内容对齐）。
  // 扫荡→测量→重推全程发生在同一帧的 rAF/RO 回调里（绘制之前），肉眼无闪烁；末态与上一帧相同时
  // RO 不再触发 → 天然收敛。editingId 不参与：页界不因聚焦变化。
  useEffect(() => {
    if (!paged || !doc) {
      setPag(null)
      return
    }
    const el = articleRef.current
    if (!el) return
    let raf = 0
    // 伪块 0 = DocHeader（标题区占第 1 页头部）；量自身 rect + 上下 margin
    const measureHeader = () => {
      const headerEl = el.querySelector('.ws-doc-header')
      if (!headerEl) return 0
      const cs = getComputedStyle(headerEl)
      return (
        headerEl.getBoundingClientRect().height +
        (parseFloat(cs.marginTop) || 0) +
        (parseFloat(cs.marginBottom) || 0)
      )
    }
    const recalc = () => {
      raf = 0
      // 铁则①：选择器全量扫荡——清掉一切推挤痕迹（含回车分裂继承出来的克隆），回到干净几何。
      el.querySelectorAll<HTMLElement>('[data-ws-pushed]').forEach((n) => {
        n.style.paddingTop = ''
        n.removeAttribute('data-ws-pushed')
        if (!n.getAttribute('style')) n.removeAttribute('style')
      })
      el.querySelectorAll('tr.ws-page-spacer').forEach((n) => n.remove())

      const hosts: HTMLElement[] = []
      const heights: number[] = [measureHeader()]
      for (const b of doc.blocks) {
        const be = blockEls.current.get(b.id)
        const host = (be?.closest('.ws-block') as HTMLElement | null) ?? be
        if (!host) return // 尚未挂全，等下一轮 RO
        hosts.push(host)
        heights.push(host.getBoundingClientRect().height)
      }
      // 超高块：干净几何下采集切分原子 → computeInnerSplits 算切分计划。
      // 切不动的（单张超页高图等）innerCutTops 给 null → paginateBlocks 走跨页拉长路径。
      const innerCutTops: (number[] | null)[] = [null]
      const plans: (
        | { atoms: CutAtom[]; cuts: { atom: number; top: number; fill: number }[] }
        | null
      )[] = [null]
      doc.blocks.forEach((_, i) => {
        const h = heights[i + 1]
        if (h <= pageBox.contentH) {
          innerCutTops.push(null)
          plans.push(null)
          return
        }
        const atoms = collectCutAtoms(hosts[i])
        const cuts = computeInnerSplits(atoms.map((a) => a.top), h, pageBox.contentH)
        innerCutTops.push(cuts.length ? cuts.map((c) => c.top) : null)
        plans.push(cuts.length ? { atoms, cuts } : null)
      })
      const r = paginateBlocks(heights, pageBox.contentH, innerCutTops)
      // 真推内容 + 铁则②灰缝锚定实测位置。推挤量 push = 切点上方剩余留白 + 页底边距 + 灰缝 + 页顶边距
      //（与块级 PageGap 同公式 → 每页恰一张纸）。锚点 = 推挤空档的起点元素：
      //  · li/代码行：paddingTop 在 border-box 内，元素 border 顶 = 空档起点；
      //  · 表格：spacer 行本身 = 空档。
      // 推完立刻量锚点真实位置，灰缝画在空档内 fill+页底边距 之后——内容在哪缝在哪。
      const gapUnit = pageBox.margin.bottom + PAGE_GAP_PX + pageBox.margin.top
      const gutters: { top: number; fill: number; page: number }[] = []
      doc.blocks.forEach((_, i) => {
        const plan = plans[i + 1]
        if (!plan) return
        const startPage = r.pageOfBlock[i + 1] // 0-based 块起始页
        plan.cuts.forEach((cut, k) => {
          const atom = plan.atoms[cut.atom]
          if (!atom || !atom.el.isConnected) return
          const push = cut.fill + gapUnit
          let anchor: HTMLElement
          if (atom.kind === 'tr') {
            const spacer = document.createElement('tr')
            spacer.className = 'ws-page-spacer'
            spacer.setAttribute('contenteditable', 'false')
            spacer.setAttribute('aria-hidden', 'true')
            const td = document.createElement('td')
            td.setAttribute('colspan', '99')
            td.setAttribute('style', `height:${push}px;padding:0;border:0;background:transparent`)
            spacer.appendChild(td)
            atom.el.parentElement?.insertBefore(spacer, atom.el)
            anchor = spacer
          } else {
            atom.el.style.paddingTop = `${push}px`
            atom.el.setAttribute('data-ws-pushed', '')
            anchor = atom.el
          }
          const paperTop = el.getBoundingClientRect().top // 纸 padding 盒顶（每次现量，推挤会移动后续内容）
          const zoneTop = anchor.getBoundingClientRect().top - paperTop // 推挤空档起点
          gutters.push({
            top: zoneTop, // 留白遮罩从空档起点铺（fill+页底边距+灰缝+页顶边距 整段）
            fill: cut.fill,
            page: startPage + k + 2, // 缝下方那一页的 1-based 页码
          })
        })
      })
      const gaps = doc.blocks.map((_, i) => {
        const g = r.gapBefore[i + 1]
        return g === null ? null : { fill: g, nextPage: r.pageOfBlock[i + 1] + 1 }
      })
      // 末页补白 = 末页剩余留白 − 文末 chrome（ws-canvas-tail + ws-doc-end 也在 article 里、
      // 会占掉末页尾部）→ 让纸面正好收在整页底、不因文末 chrome 溢出成半张纸。
      const chromeH = (sel: string) => {
        const c = el.querySelector(sel)
        if (!c) return 0
        const cs = getComputedStyle(c)
        return (
          c.getBoundingClientRect().height +
          (parseFloat(cs.marginTop) || 0) +
          (parseFloat(cs.marginBottom) || 0)
        )
      }
      const chrome = chromeH('.ws-canvas-tail') + chromeH('.ws-doc-end')
      const tailFill = Math.max(0, r.lastFill - chrome)
      setPag((prev) => {
        const next = { gaps, gutters, tailFill, pageCount: r.pageCount }
        const same =
          prev &&
          prev.pageCount === next.pageCount &&
          Math.abs(prev.tailFill - next.tailFill) < 0.5 &&
          prev.gaps.length === next.gaps.length &&
          prev.gaps.every((g, i) => {
            const ng = next.gaps[i]
            if (g === null || ng === null) return g === ng
            return Math.abs(g.fill - ng.fill) < 0.5 && g.nextPage === ng.nextPage
          }) &&
          prev.gutters.length === next.gutters.length &&
          prev.gutters.every(
            (b, i) =>
              Math.abs(b.top - next.gutters[i].top) < 0.5 &&
              Math.abs(b.fill - next.gutters[i].fill) < 0.5 &&
              b.page === next.gutters[i].page,
          )
        return same ? prev : next
      })
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(recalc)
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    // minHeight 撑住纸时打字不改 article 高度 → 还要盯内容列本身
    const blocksEl = el.querySelector('.ws-blocks')
    if (blocksEl) ro.observe(blocksEl)
    return () => {
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
    // typographyCss 入依赖：改字体/字号/行距 → 块高变 → 立即重排（+ RO 盯 .ws-blocks 兜底），
    // 保证「改字号后每页仍=一张纸」（AE3，RISK-A 最高风险联动点）。
  }, [paged, doc, pageBox, typographyCss])

  const [fmtRect, setFmtRect] = useState<FormatRect | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [aiSoonOpen, setAiSoonOpen] = useState(false)
  const [blockMenuFor, setBlockMenuFor] = useState<string | null>(null)
  const [blockMenuPos, setBlockMenuPos] = useState<{
    top: number
    left: number
  } | null>(null)
  const [slash, setSlash] = useState<{
    blockId: string
    query: string
    pos: { top: number; left: number }
    active: number
  } | null>(null)
  // @ / [[ / 【【 / 斜杠菜单 / 工具栏 文档提及菜单（互链）。trig = 触发符长度（@=1，[[/【【=2，
  // 斜杠/工具栏入口=0 不删正文）。mode 'wrap' = 工具栏「链接」按钮：把 savedRange 的选中文字变成链接
  // （保留用户文字），而不是插入目标标题。
  const [mention, setMention] = useState<{
    blockId: string
    query: string
    pos: { top: number; left: number }
    active: number
    trig: number
    mode?: 'insert' | 'wrap'
    savedRange?: Range
  } | null>(null)
  // 链接悬停预览 / 断链修复卡。anchor 存 live DOM 引用（修复动作要改它所在的块）。
  const [preview, setPreview] = useState<{
    rect: { top: number; left: number; bottom: number }
    href: string
    target: string | null
    rootId: string
    broken: boolean
    anchor: HTMLAnchorElement
  } | null>(null)
  const hoverTimer = useRef(0)
  const closeTimer = useRef(0)
  // drag-to-reorder
  const dragFrom = useRef<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) blockEls.current.set(id, el)
    else blockEls.current.delete(id)
  }, [])

  // 进入编辑态时光标落点的「意图」：单击落点击处 / Enter·插入落块首 / Esc·⋮⋮ 落块末
  const pendingCaret = useRef<{
    mode: 'point' | 'start' | 'end'
    x?: number
    y?: number
  }>({ mode: 'end' })

  const focusBlockAt = useCallback(
    (
      id: string,
      caret: { mode: 'point' | 'start' | 'end'; x?: number; y?: number },
    ) => {
      requestAnimationFrame(() => {
        const el = blockEls.current.get(id)
        if (!el) return
        // 折叠块：块根是 <details>（不可编辑）——把焦点/光标落进 summary 文字区（唯一标题编辑点）。
        const target =
          el.tagName === 'DETAILS'
            ? ((el.querySelector('.ws-toggle-summary-text') as HTMLElement | null) ?? el)
            : el
        target.focus()
        const sel = window.getSelection()
        if (!sel) return
        let range: Range | null = null
        if (caret.mode === 'point' && caret.x != null && caret.y != null) {
          const pt = caretRangeAtPoint(caret.x, caret.y)
          if (pt && target.contains(pt.startContainer)) range = pt // 落点须在块内，否则回退块末
        }
        if (!range) {
          range = document.createRange()
          range.selectNodeContents(target)
          range.collapse(caret.mode === 'start')
        }
        sel.removeAllRanges()
        sel.addRange(range)
      })
    },
    [],
  )

  // 分块制选中模型：单击选块、双击进文字编辑、点空白取消、Esc 逐级退出
  const onFocusBlock = useCallback((id: string | null) => {
    focusedBlockId.current = id
  }, [])

  const selectBlock = useCallback((id: string) => {
    setSelectedId(id)
    // 点到「别的」块时退出文字编辑；点正在编辑的块本身则保持编辑（让原生光标工作）
    setEditingId((cur) => (cur === id ? cur : null))
  }, [])

  const editBlock = useCallback(
    (
      id: string,
      caret: { mode: 'point' | 'start' | 'end'; x?: number; y?: number } = {
        mode: 'end',
      },
    ) => {
      pendingCaret.current = caret
      setSelectedId(id)
      setEditingId(id)
    },
    [],
  )

  // 单击可编辑块：进编辑 + 光标落点击位置
  const editAtPoint = useCallback(
    (id: string, x: number, y: number) =>
      editBlock(id, { mode: 'point', x, y }),
    [editBlock],
  )

  const deselect = useCallback(() => {
    setSelectedId(null)
    setEditingId(null)
    setFmtRect(null)
  }, [])

  // 页间空白/页底留白点击 → 把光标落到最近的可编辑块（修死区 #3）：
  // 从「就近两块」（gap 上方块末 / 下方块首，按点击 Y 落在 gap 上下半选序）起，
  // 向外扩散找第一个可编辑块。beforeIndex = gap 下方块的下标。
  const routeCaretFromGap = useCallback(
    (beforeIndex: number, e: React.MouseEvent) => {
      if (!doc) return
      e.stopPropagation()
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const upperHalf = e.clientY < r.top + r.height / 2
      const enter = (idx: number, mode: 'start' | 'end') => {
        const blk = doc.blocks[idx]
        if (blk && isEditable(blk)) {
          editBlock(blk.id, { mode })
          return true
        }
        return false
      }
      // 就近偏好：上半 → 先上一块末尾；下半 → 先下一块开头
      if (upperHalf) {
        if (enter(beforeIndex - 1, 'end')) return
        if (enter(beforeIndex, 'start')) return
      } else {
        if (enter(beforeIndex, 'start')) return
        if (enter(beforeIndex - 1, 'end')) return
      }
      // 就近两块都不可编辑（如巨图之间）：向外扩散找最近可编辑块
      for (let d = 1; d < doc.blocks.length; d++) {
        if (enter(beforeIndex - 1 - d, 'end')) return
        if (enter(beforeIndex + d, 'start')) return
      }
    },
    [doc, editBlock],
  )

  // 末页尾部留白 / ws-canvas-tail 点击：进末块（空则直接进，否则末尾追加正文块）。
  const enterTail = useCallback(
    (e: React.MouseEvent) => {
      if (!doc) return
      e.stopPropagation()
      const last = doc.blocks[doc.blocks.length - 1]
      const lastEl = last && blockEls.current.get(last.id)
      if (last && isEditable(last) && (lastEl?.textContent ?? '').trim() === '') {
        editBlock(last.id, { mode: 'end' })
      } else {
        checkpoint()
        editBlock(addBlock(doc.id, last ? last.id : '', 'text'), { mode: 'start' })
      }
    },
    [doc, editBlock, addBlock, checkpoint],
  )

  // 删块（带兜底）：删到只剩一块时清空成空正文并进编辑，避免空白死状态（KTD-7，不改 store）。
  const removeBlock = useCallback(
    (id: string) => {
      if (!doc) return
      checkpoint()
      if (doc.blocks.length <= 1) {
        updateBlockHtml(doc.id, id, '')
        setBlockType(doc.id, id, 'text')
        editBlock(id, { mode: 'start' })
      } else {
        deleteBlock(doc.id, id)
        deselect()
      }
    },
    [doc, updateBlockHtml, setBlockType, editBlock, deleteBlock, deselect, checkpoint],
  )

  // ===== 图片块插入管线（doc-images spec：斜杠 / 粘贴 / 拖放三入口共用）=====
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const imagePick = useRef<{ anchorId: string; replaceEmpty: boolean } | null>(null)
  const insertImages = useCallback(
    async (files: File[], anchorId: string | null, replaceEmpty = false) => {
      if (!doc || files.length === 0) return
      let after = anchorId
      let inserted = 0
      for (const f of files) {
        const r = await ingestImage(f) // 降采样护栏：长边≤1600 / base64≤1.5MB / 拒 SVG
        if (!r.ok) {
          toast(
            r.reason === 'budget'
              ? tImperative('editor.imgTooLarge')
              : r.reason === 'type'
                ? tImperative('editor.imgUnsupported')
                : tImperative('editor.imgDecodeFail'),
            'neutral',
          )
          continue
        }
        if (inserted === 0) checkpoint() // 首张成功才快照：全拒时不留空撤销步
        const alt = (f.name || '').replace(/\.[a-z0-9]+$/i, '') // 可访问性 + 未来检索
        const id = addBlock(doc.id, after, 'image', undefined, imageBlockHtml(r.src, alt))
        selectBlock(id)
        after = id
        inserted++
      }
      // 已拍板②：锚点是空段落时原地替换（先插后删，撤销合成一步）
      if (inserted > 0 && replaceEmpty && anchorId) deleteBlock(doc.id, anchorId)
    },
    [doc, addBlock, deleteBlock, selectBlock, checkpoint, toast],
  )
  // 粘贴图片。已拍板①文本优先：剪贴板有可用文本 → 交还既有文本粘贴路径，这里不拦。
  const onBlocksPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const cd = e.clipboardData
      if (!cd || !doc) return
      if (cd.getData('text/plain').trim()) return
      const files = pickImageFiles(cd)
      if (files.length === 0)
        for (const item of Array.from(cd.items))
          if (item.kind === 'file') {
            const f = item.getAsFile()
            if (f && acceptsImageType(f.type)) files.push(f)
          }
      if (files.length === 0) return
      e.preventDefault()
      const anchor = editingId ?? selectedId ?? null
      const blk = anchor ? doc.blocks.find((b) => b.id === anchor) : undefined
      const host = anchor ? blockEls.current.get(anchor) : undefined
      const replaceEmpty = blk?.type === 'text' && !(host?.textContent ?? '').trim()
      void insertImages(files, anchor, replaceEmpty)
    },
    [doc, editingId, selectedId, insertImages],
  )

  // 斜杠菜单选中某项：删掉已输入的「/query」，再插入新块 / 转换当前块 / 弹 AI 占位。
  const applySlash = useCallback(
    (key: string) => {
      if (!doc || !slash) return
      const it = SLASH_ITEMS.find((x) => x.key === key)
      setSlash(null)
      if (!it) return
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        for (let i = 0; i < slash.query.length + 1; i++)
          sel.modify('extend', 'backward', 'character')
        document.execCommand('delete')
      }
      if (it.type === 'ai') {
        setAiSoonOpen(true)
        return
      }
      if (it.type === 'doclink') {
        // 互链入口①（可发现路径）：斜杠删掉 '/query' 后原地弹文档选择菜单（trig=0：正文里没有触发符要删）
        const bid = slash.blockId
        window.setTimeout(() => {
          const rect = caretRectViewport()
          if (rect) setMention({ blockId: bid, query: '', pos: rect, active: 0, trig: 0, mode: 'insert' })
        }, 0)
        return
      }
      const el = blockEls.current.get(slash.blockId)
      const empty = !el || (el.textContent ?? '').trim() === ''
      if (it.type === 'image') {
        // 图片：开系统文件选择器，真插入在 input onChange（insertImages）。checkpoint 不在
        // 这打——用户可能取消选择，空快照会留一步无效撤销。空段落原地替换（已拍板②）。
        imagePick.current = { anchorId: slash.blockId, replaceEmpty: empty }
        imageInputRef.current?.click()
        return
      }
      checkpoint()
      if (it.type === 'divider') {
        selectBlock(addBlock(doc.id, slash.blockId, it.type))
      } else if (it.type === 'table' || it.type === 'code' || it.type === 'toggle') {
        // 表格/代码/折叠：插入带默认内容的新块并进编辑（单元格/代码行/summary 随即可点改）。
        // toggle 走 raw-edit 路径：进编辑态使 isRawEditBlock 生效，focusBlockAt 把光标落进 summary。
        editBlock(addBlock(doc.id, slash.blockId, it.type))
      } else if (it.type === 'list' && empty) {
        // 空块插列表：不在聚焦块上 setBlockType（p→ul 交换会触发 blur 把空 innerHTML 回写、
        // 得到没有 <li> 的空 <ul>）。改成 addBlock 一个带 <li> seed 的新列表块（挂载时同步进
        // DOM、没被 focus 不会被 blur 清），再删掉原空块。
        const newId = addBlock(doc.id, slash.blockId, 'list', it.listStyle)
        deleteBlock(doc.id, slash.blockId)
        editBlock(newId, { mode: 'start' })
      } else if (empty) {
        setBlockType(doc.id, slash.blockId, it.type, it.level, it.listStyle)
      } else {
        editBlock(addBlock(doc.id, slash.blockId, it.type, it.listStyle))
      }
    },
    [doc, slash, addBlock, deleteBlock, setBlockType, selectBlock, editBlock, checkpoint],
  )

  // ===== 文档互链（@提及 / 链接点击 / 悬停预览 / 断链修复）=====

  // @ 菜单候选：同根内**所有文件**（文档在前、pdf/表格/图片等其它文件在后——链接任何文件都合法，
  // 点击时非文档走系统程序面板），标题+路径都参与模糊匹配；末尾「新建」+「网址链接」。
  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!mention || !curRootId || !curPath) return []
    const q = mention.query.trim().toLowerCase()
    const docsFirst: MentionItem[] = []
    const rest: MentionItem[] = []
    for (const f of files) {
      if (f.rootId !== curRootId) continue
      if (f.path === curPath) continue // 不列自己
      const isDoc = !!f.docId && (f.kind === 'html' || f.kind === 'md')
      const title = isDoc
        ? (docs.find((d) => d.id === f.docId)?.title ?? baseOf(f.path))
        : baseOf(f.path)
      if (q && !title.toLowerCase().includes(q) && !f.path.toLowerCase().includes(q)) continue
      ;(isDoc ? docsFirst : rest).push({ key: `f:${f.path}`, title, path: f.path, kind: f.kind })
    }
    const out = [...docsFirst, ...rest].slice(0, 8)
    if (q) out.push({ key: 'create', title: t('editor.createNamed', { name: mention.query.trim() }), create: true })
    out.push({ key: 'url', title: t('editor.urlLink'), url: true })
    return out
  }, [mention, files, docs, curRootId, curPath, t])

  // 选中提及项：三种收尾——insert（@/[[/斜杠：插入目标标题快照的 <a>）、wrap（工具栏：把选中文字
  // 变成链接、保留用户文字）、url（外部网址）。链接文字=快照，改名不回写文字，靠 hover 卡看目标当前标题。
  const applyMention = useCallback(
    (key: string) => {
      if (!doc || !mention || !curRootId || !curPath) return
      const m = mention
      setMention(null)
      const el = blockEls.current.get(m.blockId)
      if (!el) return
      // ① 先定目标（校验/新建/网址都放在动正文**之前**——任何失败分支都不动正文，用户输入不凭空蒸发）
      let targetPath: string | null = null
      let title = ''
      let externalUrl: string | null = null
      if (key === 'url') {
        const url = window.prompt(tImperative('editor.linkAddressPrompt'), 'https://')
        if (!url) return
        externalUrl = url
        title = url
      } else if (key === 'create') {
        // 新建在当前文档同目录（Typora 式的文件原生答案）；不切走当前标签页（Notion 同款）
        title = m.query.trim() || tImperative('editor.untitledDoc')
        targetPath = createLinkedDoc(curRootId, dirOf(curPath), title)
        if (!targetPath) return
      } else {
        const it = mentionItems.find((x) => x.key === key)
        if (!it?.path) return
        targetPath = it.path
        title = it.title
      }
      const href = externalUrl ?? relHref(curPath, targetPath!)
      // ② wrap 模式（工具栏「链接」）：恢复保存的选区，把选中文字整体变成链接
      if (m.mode === 'wrap' && m.savedRange) {
        checkpoint()
        const sel0 = window.getSelection()
        sel0?.removeAllRanges()
        sel0?.addRange(m.savedRange)
        document.execCommand('createLink', false, href)
        updateBlockHtml(doc.id, m.blockId, el.innerHTML)
        if (key === 'create') toast(tImperative('editor.createdAndLinked', { name: title }), 'success')
        return
      }
      // ③ insert 模式：trig>0（@/[[ 手势）先用 **DOM 真相**定位「触发符+query」整段删除——不按计数
      //    回删（IME 组字/移动光标/粘贴都会让 query 计数与 DOM 失同步，按计数删会误删正文或吞掉相邻
      //    旧提及）；trig=0（斜杠/工具栏入口）没有触发符在正文里，caret 已就位，直接插。
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).startContainer)) return
      checkpoint()
      if (m.trig > 0) {
        const caret = sel.getRangeAt(0)
        const scan = document.createRange()
        scan.selectNodeContents(el)
        scan.setEnd(caret.startContainer, caret.startOffset)
        const before = scan.toString()
        const trigs = m.trig === 1 ? ['@', '＠'] : ['[[', '【【'] // i18n-exempt（@提及/[[链接的触发符，含中文 IME 全角变体，功能字符非文案）
        let idx = -1
        let tlen = m.trig
        for (const t of trigs) {
          const i = before.lastIndexOf(t)
          if (i > idx) {
            idx = i
            tlen = t.length
          }
        }
        // 只认「caret 附近」的触发符（防误伤：更早的 @ 可能是正文里的邮箱）。找不到就不删、只插入。
        if (idx >= 0 && before.length - (idx + tlen) <= Math.max(m.query.length + 8, 24)) {
          let acc = 0
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
          let node: Node | null
          while ((node = walker.nextNode())) {
            const len = (node.textContent || '').length
            if (acc + len > idx) {
              const del = document.createRange()
              del.setStart(node, idx - acc)
              del.setEnd(caret.startContainer, caret.startOffset)
              del.deleteContents()
              sel.removeAllRanges()
              sel.addRange(del) // deleteContents 后已折叠在删除起点 = 插入点
              break
            }
            acc += len
          }
        }
      }
      // contenteditable=false = 原子提及（光标越过它、退格整体删——Notion mention 同款手感）。
      // 尾随 &nbsp; 保证插入后 caret 有落点（原子行内元素后无文本时 caret 会丢；已知 wrinkle：
      // 这个 &nbsp; 会留在文档字节里，真 app 移植时用 Range/Selection API 插入并另行处理落点）。
      // 网址链接不带 ws-doclink（外链语义：点击开网页标签页、不参与互链解析/重写）。
      document.execCommand(
        'insertHTML',
        false,
        externalUrl
          ? `<a href="${escAttr(href)}">${escText(title)}</a>&nbsp;`
          : `<a class="ws-doclink" href="${escAttr(href)}" contenteditable="false">${escText(title)}</a>&nbsp;`,
      )
      updateBlockHtml(doc.id, m.blockId, el.innerHTML)
      if (key === 'create') {
        const p = targetPath
        const rid = curRootId
        toast(tImperative('editor.createdNamed', { name: title }), 'success', {
          label: tImperative('common.open'),
          run: () => {
            const f = useStore.getState().files.find((x) => x.rootId === rid && x.path === p)
            if (f) useStore.getState().openFileTab(f)
          },
        })
      }
    },
    [doc, mention, curRootId, curPath, mentionItems, createLinkedDoc, toast, checkpoint, updateBlockHtml],
  )

  // 提及触发 + 菜单键盘导航。触发：@（IME 中文态 shift+2 也直出半角，天然稳）；[[；【【（中文标点态
  // 直接支持——Obsidian 要装插件）。组字保护：菜单开着时 e.isComposing 的按键全部归输入法
  // （拼音候选的 Enter/方向键不能被当成选菜单）；组好的字从 compositionend 进 query。
  useEffect(() => {
    const caretRect = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const r = sel.getRangeAt(0).cloneRange()
      const rects = r.getClientRects()
      const rect = rects.length
        ? rects[0]
        : r.startContainer.parentElement?.getBoundingClientRect()
      if (!rect) return null
      return { top: rect.bottom + 6, left: rect.left }
    }
    // 触发检测走 **input/compositionend**（不靠 keydown 的 e.key）：Windows 中文 IME 下 keydown
    // 只给 'Process'，keydown 方案三个触发器全灭；input 事件看的是真正落进 DOM 的字符，
    // 半角 @ / 全角 ＠ / [[ / 【【 一网打尽（对抗审查抓到的 IME 形态缺口）。
    const maybeTrigger = (target: EventTarget | null) => {
      if (mention || !editingId || slash || !curRootId || !curPath) return
      // 表格/代码里 @ 、[[ 是普通字符，不触发文档提及
      if (isRawEditBlock(doc?.blocks.find((b) => b.id === editingId))) return
      const el = blockEls.current.get(editingId)
      if (!el || !(target instanceof Node) || !el.contains(target)) return
      const two = textBeforeCaret(el, 2)
      const one = two.slice(-1)
      let trig = 0
      if (two === '[[' || two === '【【') trig = 2 // i18n-exempt（触发符检测）
      else if (one === '@' || one === '＠') trig = 1 // i18n-exempt（触发符检测）
      if (!trig) return
      const rect = caretRect()
      if (rect) setMention({ blockId: editingId, query: '', pos: rect, active: 0, trig })
    }
    const onInput = (e: Event) => maybeTrigger(e.target)
    const onKey = (e: KeyboardEvent) => {
      if (!mention) return // 触发交给 input 事件；这里只管菜单开着时的键盘导航
      // IME 组字中：Enter=选字、↑↓=换候选、首个 keydown 是 229/'Process'——全归输入法，
      // 组好的字走 compositionend 进 query（keydown 直接计入会把拼音字母混进 query）。
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const it = mentionItems[mention.active]
        if (it) applyMention(it.key)
        else setMention(null)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMention((m) =>
          m ? { ...m, active: Math.max(0, Math.min(m.active + 1, mentionItems.length - 1)) } : m,
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMention((m) => (m ? { ...m, active: Math.max(0, m.active - 1) } : m))
        return
      }
      if (e.key === 'Backspace') {
        if (mention.trig === 0) e.preventDefault() // 斜杠/工具栏入口：query 是纯虚拟的，别删正文/选区
        setMention((m) =>
          m ? (m.query.length === 0 ? null : { ...m, query: m.query.slice(0, -1), active: 0 }) : m,
        )
        return
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        if (mention.trig === 0) e.preventDefault() // 同上：查询字符不落进正文（wrap 模式落进去会毁掉选区）
        setMention((m) => (m ? { ...m, query: m.query + e.key, active: 0 } : m))
      }
    }
    const onComp = (e: CompositionEvent) => {
      if (!mention) {
        maybeTrigger(e.target) // 组字提交的 ＠/【【 在 compositionend 才落定
        return
      }
      if (e.data) setMention((m) => (m ? { ...m, query: m.query + e.data, active: 0 } : m))
    }
    document.addEventListener('input', onInput, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('compositionend', onComp)
    return () => {
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('compositionend', onComp)
    }
  }, [mention, editingId, slash, curRootId, curPath, mentionItems, applyMention])

  // 断链装饰：块渲染后把解析不到目标的互链标 is-broken（红虚线）。
  // 注：demo 直接 toggle class（blur 落库会带上、下轮装饰自愈）；真 app 用非 DOM 装饰
  // （CSS Highlight 一类），绝不让装饰进磁盘字节。
  useEffect(() => {
    if (!doc || !curRootId || !curPath) return
    for (const [, el] of blockEls.current) {
      for (const a of el.querySelectorAll('a[href]')) {
        const target = resolveHref(curPath, a.getAttribute('href') || '')
        if (!target) {
          a.classList.remove('is-broken')
          continue
        }
        const ok = files.some((f) => f.rootId === curRootId && f.path === target)
        a.classList.toggle('is-broken', !ok)
        a.classList.add('ws-doclink') // 手写/粘贴的相对链接也吃互链样式与行为
      }
    }
  }, [doc, doc?.blocks, files, curRootId, curPath])

  // 链接点击（capture，先于块的进入编辑）：互链 → 应用内打开；断链 → 修复卡；http(s) → 网页标签页；
  // 其余一律 preventDefault——非编辑态块里的 <a> 是活链接，mailto:/相对路径的默认导航会把 SPA 整页打飞。
  const onBlocksClickCapture = useCallback(
    (e: React.MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') || ''
      const blockId = (a.closest('[data-block]') as HTMLElement | null)?.dataset.block
      if (/^https?:/i.test(href)) {
        // 正在编辑这个块时放行默认行为：用户是想把 caret 放进链接文字改字
        // （contenteditable 里点击本就不导航）；非编辑态才当"打开网页"。
        if (blockId && blockId === editingId) return
        e.preventDefault()
        e.stopPropagation()
        openWebTab(href, a.textContent || href)
        return
      }
      if (!curRootId || !curPath) {
        e.preventDefault() // 没有文件身份也不能让相对 href 裸导航
        return
      }
      const target = resolveHref(curPath, href)
      if (!target) {
        e.preventDefault() // 锚点/mailto/解析不了：拦下导航，不接管行为
        return
      }
      e.preventDefault()
      e.stopPropagation()
      window.clearTimeout(hoverTimer.current) // 350ms 悬停计时器还挂着的话，跳转后会对 detach 的 anchor 弹幽灵卡
      window.clearTimeout(closeTimer.current)
      const file = files.find((f) => f.rootId === curRootId && f.path === target)
      if (file) {
        setPreview(null)
        openFileTab(file)
      } else {
        const r = a.getBoundingClientRect()
        setPreview({
          rect: { top: r.top, left: r.left, bottom: r.bottom },
          href,
          target,
          rootId: curRootId,
          broken: true,
          anchor: a,
        })
      }
    },
    [curRootId, curPath, files, openFileTab, openWebTab, editingId],
  )

  // 悬停预览（350ms 延迟开、250ms 宽限关——允许把鼠标移进卡片）
  const onBlocksMouseOver = useCallback(
    (e: React.MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null
      if (!a || !curRootId || !curPath) return
      const href = a.getAttribute('href') || ''
      const target = resolveHref(curPath, href)
      if (!target) return
      window.clearTimeout(closeTimer.current)
      if (preview?.anchor === a) return
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = window.setTimeout(() => {
        const fresh = useStore.getState().files
        const r = a.getBoundingClientRect()
        setPreview({
          rect: { top: r.top, left: r.left, bottom: r.bottom },
          href,
          target,
          rootId: curRootId,
          broken: !fresh.some((f) => f.rootId === curRootId && f.path === target),
          anchor: a,
        })
      }, 350)
    },
    [curRootId, curPath, preview],
  )
  const onBlocksMouseOut = useCallback((e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a')
    if (!a) return
    window.clearTimeout(hoverTimer.current)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setPreview(null), 250)
  }, [])
  const keepPreview = useCallback(() => window.clearTimeout(closeTimer.current), [])
  const leavePreview = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setPreview(null), 200)
  }, [])

  // 切文档/标签：提及菜单、预览卡、悬停计时器全部失效清掉——preview.anchor 是上一篇的 DOM 引用，
  // 留着会让修复卡跨文档存活、rebind 写到 detach 的节点上（对抗审查抓到的坑）。卸载同理。
  useEffect(() => {
    setMention(null)
    setPreview(null)
    window.clearTimeout(hoverTimer.current)
    window.clearTimeout(closeTimer.current)
    return () => {
      window.clearTimeout(hoverTimer.current)
      window.clearTimeout(closeTimer.current)
    }
  }, [doc?.id])

  // 互链入口③：把侧栏文件拖进正文 → 在落点插入指向它的链接（对文件系产品这是最自然的手势，
  // Obsidian 同款）。同根才收（跨根 v1 不支持）；用 Range.insertNode 直插——不依赖 execCommand，
  // 非编辑态的块也能收（contenteditable 关着 execCommand 不干活）。
  const onBlocksDragOver = useCallback(
    (e: React.DragEvent) => {
      const f = getDragFile()
      if (!f) {
        // OS 文件拖入（doc-images）：dragover 阶段只知道 'Files'、看不到 MIME——先放行，
        // drop 时按图片白名单过滤（非图仍拒 + toast，不静默）。
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
        return
      }
      if (!curRootId || !curPath || f.rootId !== curRootId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
    },
    [curRootId, curPath],
  )
  const onBlocksDrop = useCallback(
    (e: React.DragEvent) => {
      const f = getDragFile()
      if (!f && e.dataTransfer.types.includes('Files')) {
        // OS 文件拖入 → 图片块（doc-images）。非图片文件维持拒绝口径，但要说出来。
        e.preventDefault()
        e.stopPropagation()
        if (!doc) return
        const files = pickImageFiles(e.dataTransfer)
        if (files.length === 0) {
          toast(tImperative('editor.dropImageOnly'), 'neutral')
          return
        }
        // 落点：Y 最近的块；落在其上半且非首块 → 插到它前面，否则插到它后面
        let best: { id: string; idx: number; mid: number; dist: number } | null = null
        for (const [id, el] of blockEls.current) {
          const idx = doc.blocks.findIndex((b) => b.id === id)
          if (idx < 0 || !document.contains(el)) continue
          const r = el.getBoundingClientRect()
          const dist =
            e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0
          const mid = (r.top + r.bottom) / 2
          if (!best || dist < best.dist) best = { id, idx, mid, dist }
        }
        const anchor = best
          ? e.clientY < best.mid && best.idx > 0
            ? doc.blocks[best.idx - 1].id
            : best.id
          : null // 空文档：append
        void insertImages(files, anchor)
        return
      }
      if (!f || !doc) return
      if (!curRootId || !curPath) return
      if (f.rootId !== curRootId) {
        // 跨根不支持（相对路径算不出来）——但要**说出来**，静默没反应会让人以为功能不存在
        e.preventDefault()
        e.stopPropagation()
        toast(tImperative('editor.crossFolderLink'), 'neutral')
        return
      }
      // 精确落点：落在文字上就插在那；落在装饰块/空白/边距上 → 兜底找 Y 方向最近的可编辑块，
      // 插到它末尾（静默失败 = 用户以为「没做出来」，Colin 实测踩过）。
      let range = caretRangeAtPoint(e.clientX, e.clientY)
      let host =
        (range &&
          ((range.startContainer instanceof Element
            ? range.startContainer
            : range.startContainer.parentElement
          )?.closest?.('[data-block]') as HTMLElement | null)) ||
        null
      let bid = host?.dataset.block
      let blk = bid ? doc.blocks.find((b) => b.id === bid) : undefined
      if (!bid || !blk || !isEditable(blk)) {
        let best: { bid: string; dist: number; el: HTMLElement } | null = null
        for (const [id, el] of blockEls.current) {
          const bb = doc.blocks.find((b) => b.id === id)
          if (!bb || !isEditable(bb) || !document.contains(el)) continue
          const r = el.getBoundingClientRect()
          const dist = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0
          if (!best || dist < best.dist) best = { bid: id, dist, el }
        }
        if (!best) {
          e.preventDefault()
          e.stopPropagation()
          toast(tImperative('editor.noTextBlock'), 'neutral')
          return
        }
        bid = best.bid
        blk = doc.blocks.find((b) => b.id === bid)
        range = document.createRange()
        range.selectNodeContents(best.el)
        range.collapse(false) // 插到该块末尾
      }
      if (!range || !bid || !blk) return
      e.preventDefault()
      e.stopPropagation()
      checkpoint()
      const title = (f.docId && docs.find((d) => d.id === f.docId)?.title) || baseOf(f.path)
      const a = document.createElement('a')
      a.className = 'ws-doclink'
      a.setAttribute('href', relHref(curPath, f.path))
      a.setAttribute('contenteditable', 'false')
      a.textContent = title
      range.insertNode(a)
      a.insertAdjacentText('afterend', ' ')
      const el = blockEls.current.get(bid)
      if (el) updateBlockHtml(doc.id, bid, el.innerHTML)
    },
    [doc, curRootId, curPath, docs, checkpoint, updateBlockHtml, toast, insertImages],
  )

  // 断链修复①：重新指向候选文件（改这一条链接的 href，落库该块）
  const rebindLink = useCallback(
    (candidate: FileEntry) => {
      if (!doc || !preview || !curPath) return
      if (!document.contains(preview.anchor)) {
        // anchor 已 detach（文档切换/块重渲）——别对着空气改还报成功
        toast(tImperative('editor.linkGone'), 'danger')
        setPreview(null)
        return
      }
      checkpoint()
      const suffix = splitHrefSuffix(preview.anchor.getAttribute('href') || '')[1]
      preview.anchor.setAttribute('href', relHref(curPath, candidate.path) + suffix)
      preview.anchor.classList.remove('is-broken')
      const blockEl = preview.anchor.closest('[data-block]') as HTMLElement | null
      const bid = blockEl?.dataset.block
      if (blockEl && bid) updateBlockHtml(doc.id, bid, blockEl.innerHTML)
      toast(tImperative('editor.repointedTo', { path: candidate.path }), 'success')
      setPreview(null)
    },
    [doc, preview, curPath, checkpoint, updateBlockHtml, toast],
  )
  // 断链修复②：按断链路径原地新建目标文档（建完链接自然解析通、红虚线自愈）。
  // 尊重断链的扩展名——.md 断链就建 .md（建 .html 接不上链接，红着还谎报成功）。
  const createAtBroken = useCallback(() => {
    if (!preview?.target || !curRootId) return
    const isMd = /\.md$/i.test(preview.target)
    const title = baseOf(preview.target).replace(/\.(html|md)$/i, '')
    const p = createLinkedDoc(curRootId, dirOf(preview.target), title, isMd ? '.md' : '.html')
    if (p) toast(tImperative('editor.createdNamed', { name: `${title}${isMd ? '.md' : ''}` }), 'success')
    setPreview(null)
  }, [preview, curRootId, createLinkedDoc, toast])

  // 行首 markdown 触发：正文块里打 `- `/`1. `/`[] `/`> `/`# ` 自动转成对应块、清掉前缀。
  const tryMarkdown = useCallback(
    (blockId: string) => {
      if (!doc) return
      const blk = doc.blocks.find((b) => b.id === blockId)
      if (!blk || blk.type !== 'text') return // 只在正文块触发
      const el = blockEls.current.get(blockId)
      if (!el) return
      const md = detectMarkdown(el.textContent ?? '')
      if (!md) return
      checkpoint()
      // 「新建目标块 + 删原块」替换，而非原地 setBlockType：原块即将被删，其 contenteditable
      // 重挂时的 blur 回写落到已删块上=无副作用，避免把残留的 marker 文本写进新块（沿用斜杠菜单做法）。
      const newId = addBlock(doc.id, blockId, md.type, md.listStyle)
      updateBlockHtml(doc.id, newId, md.type === 'list' ? '<li></li>' : '')
      if (md.type === 'heading' && md.level && md.level !== 2) {
        setBlockType(doc.id, newId, 'heading', md.level)
      }
      deleteBlock(doc.id, blockId)
      editBlock(newId, { mode: 'start' })
    },
    [doc, addBlock, updateBlockHtml, setBlockType, deleteBlock, editBlock, checkpoint],
  )

  // 进入编辑态时聚焦该块，光标按 pendingCaret 意图落点（点击处 / 块首 / 块末）
  useEffect(() => {
    if (!editingId) return
    const caret = pendingCaret.current
    pendingCaret.current = { mode: 'end' }
    focusBlockAt(editingId, caret)
  }, [editingId, focusBlockAt])

  // Esc：编辑 → 退回块选中；已选中 → 取消选中。
  // Delete/Backspace（选中且非编辑态）→ 删整块，替代原来的 × 按钮。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (slash) return // 斜杠菜单开时让斜杠监听处理按键
      // ── 作用域守卫（shortcuts.html §1 派发原则）──
      // ① 焦点在侧栏输入框（筛选/改名/地址栏）时，编辑器一个键都不抢——
      //    修「Cmd+Z 劫持侧栏输入框原生撤销」的老毛病。
      const ae = document.activeElement
      if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return
      // ② 弹层最优先：任何 modal/面板开着时编辑器快捷键不穿透。
      if (anyOverlayOpen(useUI.getState())) return
      // 撤销 / 重做（Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z）。先 blur 提交并清焦点——否则被聚焦块的
      // contenteditable 不会从 store 重渲染；再 deselect 让恢复的内容贴回 DOM。
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        if (e.shiftKey) redo()
        else undo()
        deselect()
        return
      }
      // Ctrl+Y 重做——仅 Windows（Win 标配别名;mac 上 Ctrl+Y 是文本系统的 yank,不占）。
      if (!IS_MAC && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        redo()
        deselect()
        return
      }
      // 当前块 = 光标所在块或灰选中块（两个态的键位统一从这里解析,Notion 双态模型）
      const curId = editingId ?? selectedId
      // 正在编辑表格/代码这类原生编辑块时，结构性按键（Enter 建块 / Backspace 并块 / Tab / 跨块方向键）
      // 全部让给浏览器原生，别把新行当成新块、别把光标弹出编辑区。
      const rawEdit = isRawEditBlock(
        editingId ? doc?.blocks.find((b) => b.id === editingId) : undefined,
      )
      // 把「编辑中的活内容」先写回 store,让复制/移动拿到最新文字（不打 checkpoint）
      const commitLive = () => {
        if (!doc || !editingId) return
        const el = blockEls.current.get(editingId)
        if (el) updateBlockHtml(doc.id, editingId, el.innerHTML)
      }
      // 转块：mac ⌘⌥0–6 / Windows Ctrl+Shift+0–6（Notion 同款平台分歧;Win 不用 Ctrl+Alt——
      // 欧洲键盘 AltGr 就是 Ctrl+Alt,占了会吃正常字符输入）。0 正文 · 1/2/3 标题 · 4 待办 ·
      // 5 无序 · 6 有序。用 e.code——mac Option+数字、Win Shift+数字都会变出别的字符,e.key 不可靠。
      const turnCombo =
        (e.metaKey && e.altKey && !e.ctrlKey) ||
        (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey)
      if (turnCombo && /^Digit[0-6]$/.test(e.code) && doc && curId) {
        e.preventDefault()
        const d = Number(e.code.slice(5))
        const targets: [BlockType, (1 | 2 | 3)?, ListStyle?][] = [
          ['text'],
          ['heading', 1],
          ['heading', 2],
          ['heading', 3],
          ['list', undefined, 'todo'],
          ['list', undefined, 'bulleted'],
          ['list', undefined, 'numbered'],
        ]
        const [t, lv, ls] = targets[d]
        commitLive()
        turnInto(t, lv, ls, curId)
        return
      }
      // ⌘D 复制当前块（复制体插在下方并选中,同 Notion）
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'd' || e.key === 'D') && doc && curId) {
        e.preventDefault()
        commitLive()
        checkpoint()
        const newId = duplicateBlock(doc.id, curId)
        selectBlock(newId)
        return
      }
      // ⌘⇧↑/↓ 上移/下移当前块（键盘版拖块）
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && doc && curId) {
        e.preventDefault()
        const idx = doc.blocks.findIndex((b) => b.id === curId)
        const to = e.key === 'ArrowUp' ? idx - 1 : idx + 1
        if (idx < 0 || to < 0 || to >= doc.blocks.length) return
        commitLive()
        checkpoint()
        reorderBlocks(doc.id, idx, to)
        if (editingId) editBlock(curId, { mode: 'end' })
        return
      }
      // ⌘⇧K 删除当前块（VS Code「删行」→ 映射删块；调研裁决：绝不用 ⌘D，那已是复制块）。
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K') && doc && curId) {
        e.preventDefault()
        const idx = doc.blocks.findIndex((b) => b.id === curId)
        const fallback = doc.blocks[idx + 1]?.id ?? doc.blocks[idx - 1]?.id ?? null
        checkpoint()
        deleteBlock(doc.id, curId)
        if (fallback) selectBlock(fallback)
        else deselect()
        return
      }
      // ⌘⇧7 有序 / ⌘⇧8 无序列表（Google Docs 直达键，肌肉记忆强）。用 e.code——Shift+数字在 mac 会变符号，e.key 不可靠。
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !e.altKey &&
        (e.code === 'Digit7' || e.code === 'Digit8') &&
        doc &&
        curId
      ) {
        e.preventDefault()
        commitLive()
        turnInto('list', undefined, e.code === 'Digit7' ? 'numbered' : 'bulleted', curId)
        return
      }
      // ⌘⇧H 高亮（Notion 键位；套默认高亮色。有文字选区或选中块时才拦，否则放行）。
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        const sel = window.getSelection()
        const hasSel = !!sel && !sel.isCollapsed && sel.rangeCount > 0
        if (hasSel || selectedId) {
          e.preventDefault()
          applyCmd('hiliteColor', '#fff59d')
          return
        }
      }
      // ⌘A 分级全选（Notion 式）：块内文字未全选 → 全选块内文字；已全选 → 升到块选中态。
      // （块编辑器里一步选全文会误伤；逐级放大才顺手。全文多块选中需多选基建，本期到块选中态为止。）
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A') && editingId && doc) {
        const el = blockEls.current.get(editingId)
        const sel = window.getSelection()
        if (el && sel) {
          const blockText = (el.textContent ?? '').trim()
          const allSelected = blockText.length > 0 && sel.toString().trim() === blockText
          e.preventDefault()
          if (!allSelected) {
            const r = document.createRange()
            r.selectNodeContents(el)
            sel.removeAllRanges()
            sel.addRange(r)
          } else {
            selectBlock(editingId) // 已全选 → 升到块选中态（退出文字编辑）
          }
          return
        }
      }
      // ⌘Enter 待办打勾/取消（光标在待办项里,或选中待办块时切第一项）
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && doc && curId) {
        if (e.isComposing || e.keyCode === 229) return
        const blk = doc.blocks.find((b) => b.id === curId)
        if (blk && blk.type === 'list' && blk.listStyle === 'todo') {
          e.preventDefault()
          const el = blockEls.current.get(curId)
          if (!el) return
          let li: HTMLElement | null = null
          if (editingId) {
            const sel = window.getSelection()
            const sc = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null
            li = ((sc?.nodeType === 1 ? (sc as Element) : sc?.parentElement)?.closest('li') as HTMLElement) ?? null
          }
          if (!li) li = el.querySelector('li')
          if (!li) return
          checkpoint()
          li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true'
          updateBlockHtml(doc.id, curId, el.innerHTML)
          return
        }
      }
      // 其余 ⌘/Ctrl+Enter：不是待办就什么都不做——直接 return,别掉进下面的
      // 普通 Enter 分支误建新块（那个分支不查修饰键）。
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') return
      // ⌘⇧V 粘贴为纯文本（去来源格式;W/G/N 三家一致的肌肉记忆）
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'v' || e.key === 'V') && editingId) {
        e.preventDefault()
        navigator.clipboard
          ?.readText?.()
          .then((t) => {
            if (!t) return
            checkpoint()
            document.execCommand('insertText', false, t)
          })
          .catch(() => {}) // 剪贴板权限被拒 → 静默放弃
        return
      }
      // 文字格式快捷键 → 复用工具栏现有命令（不新增操作）。仅在有文字选区或选中块时
      // 拦截，否则交还浏览器（光标态的 Cmd+B 等仍走原生）。
      // 删除线 = ⌘⇧X（裁决 4：Word/Docs 阵营;⌘⇧S 已还给「另存为」）。
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const sel = window.getSelection()
        const hasSel = !!sel && !sel.isCollapsed && sel.rangeCount > 0
        if (hasSel || selectedId) {
          const k = e.key.toLowerCase()
          const cmd =
            e.shiftKey && k === 'x'
              ? 'strikeThrough'
              : e.shiftKey
                ? null
                : ({ b: 'bold', i: 'italic', u: 'underline', e: '__code__', k: 'createLink' } as Record<
                    string,
                    string
                  >)[k]
          if (cmd) {
            e.preventDefault()
            applyCmd(cmd)
            return
          }
        }
      }
      // Enter：可编辑块末尾 → 新建正文块（IME 组词 / Shift 软换行 / 中间 各自交还原生）
      if (e.key === 'Enter' && editingId && doc && !rawEdit) {
        if (e.isComposing || e.keyCode === 229) return // 中文/日文输入法组词中 = 确认候选词
        if (e.shiftKey) return // 软换行
        const el = blockEls.current.get(editingId)
        const blk = doc.blocks.find((b) => b.id === editingId)
        if (!el || !blk) return
        if (blk.type === 'list') {
          // 列表内：在「空的最后一项」上回车 → 跳出列表（删空项，列表后建正文；列表删空则整块转正文）。
          // 其余（非空 / 非末项）交原生（新 <li>）。
          const sel = window.getSelection()
          const sc = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null
          const li = (sc?.nodeType === 1 ? (sc as Element) : sc?.parentElement)?.closest('li')
          const items = [...el.querySelectorAll('li')]
          if (li && (li.textContent ?? '').trim() === '' && items[items.length - 1] === li) {
            e.preventDefault()
            checkpoint()
            if (items.length <= 1) {
              const newId = addBlock(doc.id, editingId, 'text')
              deleteBlock(doc.id, editingId)
              editBlock(newId, { mode: 'start' })
            } else {
              li.remove()
              updateBlockHtml(doc.id, editingId, el.innerHTML)
              editBlock(addBlock(doc.id, editingId, 'text'), { mode: 'start' })
            }
          }
          return
        }
        if (!isCaretAtBlockEnd(el)) return // 光标在中间 → 原生换行（本期不分裂）
        e.preventDefault()
        checkpoint()
        editBlock(addBlock(doc.id, editingId, 'text'), { mode: 'start' })
        return
      }
      // 灰选中态按 Enter：在选中块后插正文块并进编辑（兜底，可在不可编辑块后插块）
      if (e.key === 'Enter' && selectedId && !editingId && doc) {
        if (e.isComposing || e.keyCode === 229) return
        // 焦点在图片说明（figcaption）里：这是块内编辑，不是选中态操作（防插块）
        if ((e.target as HTMLElement)?.closest?.('figcaption')) return
        e.preventDefault()
        checkpoint()
        editBlock(addBlock(doc.id, selectedId, 'text'), { mode: 'start' })
        return
      }
      // Tab / Shift-Tab：仅在列表内做缩进/反缩进（嵌套子列表，沿用本块的 ul/ol + 样式 class）；
      // 其他块也吞掉 Tab，避免它把光标跳出编辑区。
      if (e.key === 'Tab' && editingId && doc && !rawEdit) {
        const el = blockEls.current.get(editingId)
        const blk = doc.blocks.find((b) => b.id === editingId)
        e.preventDefault()
        if (!el || !blk || blk.type !== 'list') return
        const sel = window.getSelection()
        const sc = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null
        const li = (sc?.nodeType === 1 ? (sc as Element) : sc?.parentElement)?.closest('li')
        if (!li || !el.contains(li)) return
        if (e.shiftKey) {
          const parentList = li.parentElement
          const hostLi = parentList?.parentElement
          if (hostLi && hostLi.tagName === 'LI') {
            checkpoint()
            hostLi.after(li)
            if (parentList && !parentList.querySelector('li')) parentList.remove()
            updateBlockHtml(doc.id, editingId, el.innerHTML)
          }
        } else {
          const prev = li.previousElementSibling
          if (prev && prev.tagName === 'LI') {
            checkpoint()
            let sub = prev.lastElementChild
            if (!sub || (sub.tagName !== 'UL' && sub.tagName !== 'OL')) {
              sub = document.createElement(el.tagName.toLowerCase())
              sub.className = el.className
              prev.appendChild(sub)
            }
            sub.appendChild(li)
            updateBlockHtml(doc.id, editingId, el.innerHTML)
          }
        }
        const r = document.createRange()
        r.selectNodeContents(li)
        r.collapse(false)
        sel?.removeAllRanges()
        sel?.addRange(r)
        return
      }
      // Backspace 在可编辑块最前端：空块→删块、光标落上一块末；非空→并入上一块。
      // 这是「空行删不掉 / Enter 刷出一堆空块」问题的解药。
      if (e.key === 'Backspace' && editingId && doc && !rawEdit) {
        if (e.isComposing || e.keyCode === 229) return
        const el = blockEls.current.get(editingId)
        if (!el || !isCaretAtBlockStart(el)) return // 非块首 → 原生删字符
        const idx = doc.blocks.findIndex((b) => b.id === editingId)
        if (idx <= 0) return // 第一块 → 原生（无上一块可并）
        const prev = doc.blocks[idx - 1]
        const curEmpty = (el.textContent ?? '').trim() === ''
        e.preventDefault()
        checkpoint()
        if (isEditable(prev)) {
          if (!curEmpty) {
            const prevEl = blockEls.current.get(prev.id)
            updateBlockHtml(doc.id, prev.id, (prevEl?.innerHTML ?? '') + el.innerHTML)
          }
          deleteBlock(doc.id, editingId)
          editBlock(prev.id, { mode: 'end' })
        } else if (curEmpty) {
          // 上一块不可编辑：空块直接删并选中上一块（非空则不动，避免吞内容）
          deleteBlock(doc.id, editingId)
          selectBlock(prev.id)
        }
        return
      }
      // 跨块方向键：末行↓→下一块、首行↑→上一块（尽量保持列位置）；块中间交还原生。
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && editingId && doc && !rawEdit) {
        if (e.isComposing || e.keyCode === 229) return
        const el = blockEls.current.get(editingId)
        const sel = window.getSelection()
        if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return
        const er = el.getBoundingClientRect()
        const box = sel.getRangeAt(0).getBoundingClientRect()
        const degenerate = box.height === 0 && box.top === 0 // 空块等 caret 取不到位置
        const caret = degenerate
          ? { top: er.top, bottom: er.bottom, left: er.left }
          : box
        const lh = (degenerate ? Math.min(er.height, 24) : box.height) || 20
        const idx = doc.blocks.findIndex((b) => b.id === editingId)
        if (e.key === 'ArrowDown') {
          if (caret.bottom < er.bottom - lh * 0.5) return // 不在末行 → 原生
          const next = doc.blocks[idx + 1]
          if (!next) return
          e.preventDefault()
          if (isEditable(next)) {
            const nr = blockEls.current.get(next.id)?.getBoundingClientRect()
            editBlock(next.id, {
              mode: 'point',
              x: caret.left,
              y: nr ? nr.top + lh * 0.5 : caret.left,
            })
          } else selectBlock(next.id)
        } else {
          if (caret.top > er.top + lh * 0.5) return // 不在首行 → 原生
          const prev = doc.blocks[idx - 1]
          if (!prev) return
          e.preventDefault()
          if (isEditable(prev)) {
            const pr = blockEls.current.get(prev.id)?.getBoundingClientRect()
            editBlock(prev.id, {
              mode: 'point',
              x: caret.left,
              y: pr ? pr.bottom - lh * 0.5 : caret.left,
            })
          } else selectBlock(prev.id)
        }
        return
      }
      if (e.key === 'Escape') {
        if (editingId) setEditingId(null)
        else if (selectedId) deselect()
        return
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedId &&
        !editingId &&
        doc
      ) {
        // 焦点在图片说明（figcaption）里：删的是说明文字，不是整块（防误删图）
        if ((e.target as HTMLElement)?.closest?.('figcaption')) return
        e.preventDefault()
        removeBlock(selectedId)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    editingId,
    selectedId,
    deselect,
    deleteBlock,
    doc,
    slash,
    addBlock,
    editBlock,
    removeBlock,
    updateBlockHtml,
    selectBlock,
    setBlockType,
    checkpoint,
    undo,
    redo,
    duplicateBlock,
    reorderBlocks,
  ])

  // 浮动工具栏位置：① 编辑态有文字选区 → 浮在选区上方；② 块被选中（非编辑）→ 浮在块上方；
  // ③ 否则隐藏。selectionchange 与 选中/编辑态变化都会重算。
  useEffect(() => {
    const computeRect = (): FormatRect | null => {
      const root = scrollRef.current
      if (!root) return null
      const sr = root.getBoundingClientRect()
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        const anchor = range.startContainer.parentElement
        const inEditable = anchor?.closest('[contenteditable="true"]')
        if (inEditable && root.contains(inEditable)) {
          const r = range.getBoundingClientRect()
          if (r.width !== 0 || r.height !== 0) {
            return {
              top: r.top - sr.top + root.scrollTop - 46,
              left: r.left - sr.left + r.width / 2,
            }
          }
        }
      }
      if (selectedId && !editingId) {
        const blk = doc?.blocks.find((b) => b.id === selectedId)
        const el = blockEls.current.get(selectedId)
        // 仅可编辑块在「块选中」态浮出格式工具栏；不可编辑/designed 块的操作走 ⋮⋮ 菜单
        if (blk && isEditable(blk) && el) {
          const r = el.getBoundingClientRect()
          return {
            top: r.top - sr.top + root.scrollTop - 46,
            left: r.left - sr.left + Math.min(r.width / 2, 180),
          }
        }
      }
      return null
    }
    const update = () => setFmtRect(computeRect())
    update()
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [selectedId, editingId, doc?.id])

  // 斜杠 `/` 触发 + 菜单键盘导航（筛选 / 上下选 / Enter 选 / Esc 关）
  useEffect(() => {
    const caretRect = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const r = sel.getRangeAt(0).cloneRange()
      const rects = r.getClientRects()
      const rect = rects.length
        ? rects[0]
        : r.startContainer.parentElement?.getBoundingClientRect()
      if (!rect) return null
      return { top: rect.bottom + 6, left: rect.left }
    }
    const onKey = (e: KeyboardEvent) => {
      if (mention) return // @提及菜单开着：按键归它（两菜单互斥）
      if (!slash) {
        if (e.key === '/' && editingId && !e.metaKey && !e.ctrlKey) {
          // 表格/代码里的 '/' 是普通字符，不弹斜杠菜单
          if (isRawEditBlock(doc?.blocks.find((b) => b.id === editingId))) return
          const bid = editingId
          window.setTimeout(() => {
            const rect = caretRect()
            if (rect) setSlash({ blockId: bid, query: '', pos: rect, active: 0 })
          }, 0)
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlash(null)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const it = filterSlash(slash.query, t)[slash.active]
        if (it) applySlash(it.key)
        else setSlash(null)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlash((s) =>
          s
            ? {
                ...s,
                active: Math.max(
                  0,
                  Math.min(s.active + 1, filterSlash(s.query, t).length - 1),
                ),
              }
            : s,
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlash((s) => (s ? { ...s, active: Math.max(0, s.active - 1) } : s))
        return
      }
      if (e.key === 'Backspace') {
        setSlash((s) =>
          s
            ? s.query.length === 0
              ? null
              : { ...s, query: s.query.slice(0, -1), active: 0 }
            : s,
        )
        return
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        setSlash((s) => (s ? { ...s, query: s.query + e.key, active: 0 } : s))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [slash, mention, editingId, doc?.id, applySlash, paged, t])

  // persist the block the toolbar just edited
  const persistFocused = useCallback(() => {
    const id = focusedBlockId.current
    if (!id || !doc) return
    const el = blockEls.current.get(id)
    if (el) updateBlockHtml(doc.id, id, el.innerHTML)
  }, [doc, updateBlockHtml])

  if (!doc) {
    return (
      <main className="ws-canvas ws-canvas-empty">
        <div className="ws-empty">{t('editor.emptyDoc')}</div>
      </main>
    )
  }

  // 块选中（非编辑）态下要对整块套格式：先让块可编辑、聚焦、全选，再跑 execCommand，最后落库。
  const execOnBlock = (blockId: string, run: () => void) => {
    const blk = doc.blocks.find((b) => b.id === blockId)
    if (!blk || !isEditable(blk)) return // 不可编辑/designed 块不可被置 contentEditable（防污染 AI HTML）
    const el = blockEls.current.get(blockId)
    if (!el) return
    el.setAttribute('contenteditable', 'true')
    setEditingId(blockId)
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    try {
      document.execCommand('styleWithCSS', false, true)
    } catch {
      /* ignore */
    }
    run()
    updateBlockHtml(doc.id, blockId, el.innerHTML)
  }

  // 行内代码：execCommand 没有，自己把选区包进 <code>
  const wrapCode = () => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const code = document.createElement('code')
    try {
      range.surroundContents(code)
    } catch {
      code.appendChild(range.extractContents())
      range.insertNode(code)
    }
  }

  // 工具栏命令统一入口：有文字选区 → 作用于选区；否则作用于被选中的整块。
  const applyCmd = (command: string, value?: string) => {
    const sel = window.getSelection()
    const hasText =
      !!editingId && !!sel && !sel.isCollapsed && sel.rangeCount > 0

    if (command === 'createLink') {
      // 互链入口②（可发现路径）：工具栏「链接」不再是裸网址 prompt，而是弹文档选择菜单——
      // 选中文字 → wrap 模式（选中文字变链接，保留用户文字）；菜单里也有「网址链接…」兜底外链。
      const saved = hasText ? sel!.getRangeAt(0).cloneRange() : null
      const bid = editingId ?? selectedId
      if (curRootId && curPath && bid && saved) {
        const r = saved.getBoundingClientRect()
        setMention({
          blockId: bid,
          query: '',
          pos: { top: r.bottom + 8, left: r.left },
          active: 0,
          trig: 0,
          mode: 'wrap',
          savedRange: saved,
        })
        return
      }
      if (curRootId && curPath && editingId) {
        // 无选区但在编辑态：caret 处插入提及（insert 模式）
        const rect = caretRectViewport()
        if (rect) {
          setMention({ blockId: editingId, query: '', pos: rect, active: 0, trig: 0, mode: 'insert' })
          return
        }
      }
      // 兜底（无文件身份的临时文档 / 块选中态整块加链）：维持原网址 prompt 行为
      const url = window.prompt(tImperative('editor.linkAddressPrompt'), 'https://')
      if (!url) return
      if (saved) {
        const s = window.getSelection()
        s?.removeAllRanges()
        s?.addRange(saved)
        document.execCommand('createLink', false, url)
        persistFocused()
      } else if (selectedId) {
        execOnBlock(selectedId, () =>
          document.execCommand('createLink', false, url),
        )
      }
      return
    }

    const run = () => {
      if (command === '__code__') wrapCode()
      else document.execCommand(command, false, value)
    }
    if (hasText) {
      try {
        document.execCommand('styleWithCSS', false, true)
      } catch {
        /* ignore */
      }
      run()
      persistFocused()
    } else if (selectedId) {
      execOnBlock(selectedId, run)
    }
  }

  // targetId 缺省 = 选中块（浮条「转为」菜单的原有路径）；键盘转块（⌘⌥0-6）从光标所在块
  // 显式传入——光标态不经过 selectedId。
  const turnInto = (type: BlockType, level?: 1 | 2 | 3, listStyle?: ListStyle, targetId?: string) => {
    const id = targetId ?? selectedId
    if (!id) return
    const blk = doc.blocks.find((b) => b.id === id)
    if (!blk) return
    checkpoint()
    const wasList = blk.type === 'list'
    const willList = type === 'list'
    // 跨列表边界（段落↔列表）用「新建块替换」而非原地 setBlockType：避免被编辑的
    // contenteditable 在元素重挂时 blur 把旧形态内容写回、污染 <li> 包裹（沿用斜杠菜单做法）。
    if (willList !== wasList) {
      const el = blockEls.current.get(id)
      const live = el ? el.innerHTML : blk.html
      const newId = addBlock(doc.id, id, type, listStyle)
      updateBlockHtml(
        doc.id,
        newId,
        willList ? `<li>${live.trim()}</li>` : unwrapListHtml(live),
      )
      if (!willList && level) setBlockType(doc.id, newId, type, level)
      deleteBlock(doc.id, id)
      editBlock(newId, { mode: 'end' })
      return
    }
    // 同形态（列表样式互换 / 文本类互转）：直接改类型
    setBlockType(doc.id, id, type, level, listStyle)
  }

  const askAI = () => setAiSoonOpen(true)

  // 点 ⋮⋮ 手柄打开块操作菜单（pos = 视口坐标）
  const openBlockMenu = (id: string, pos: { top: number; left: number }) => {
    selectBlock(id)
    setBlockMenuFor(id)
    setBlockMenuPos(pos)
  }
  const closeBlockMenu = () => {
    setBlockMenuFor(null)
    setBlockMenuPos(null)
  }

  // --- drag reorder ---
  const onDragStart = (index: number) => {
    dragFrom.current = index
  }
  const onDragOver = (index: number) => {
    if (dragFrom.current === null) return
    setDropIndex(index)
  }
  const onDrop = () => {
    const from = dragFrom.current
    const to = dropIndex
    if (from !== null && to !== null && from !== to) {
      checkpoint()
      reorderBlocks(doc.id, from, to)
    }
    dragFrom.current = null
    setDropIndex(null)
  }
  const onDragEnd = () => {
    dragFrom.current = null
    setDropIndex(null)
  }

  return (
    <main className={'ws-canvas' + (embedded ? ' ws-canvas-embed' : '')}>
      {/* 文档内查找条（Cmd+F）。key=doc.id：切文档时重挂、重搜、清旧高亮 */}
      {docFindOpen && (
        <DocFind key={doc.id} container={scrollRef.current} onClose={closeDocFind} />
      )}
      {/* 点空白处（非任何块）取消选中——块的 onClick 会 stopPropagation，故此处只接到空白点击 */}
      <div
        className={'ws-canvas-scroll' + (paged ? ' is-paged' : '')}
        ref={scrollRef}
        onClick={deselect}
      >
        <article
          ref={articleRef}
          className={
            `ws-doc ws-doc-${doc.kind}` +
            (doc.pageFormat ? ` ws-fmt ws-fmt-${doc.pageFormat}` : '') +
            (paged ? ' ws-doc-paged' : '') +
            (scopedTplCss ? ' ws-tpl-on' : '')
          }
          // 分页视图：纸宽 = 纸张 px 宽，padding = 页边距（内容列自然收窄为页内容宽）。
          // 页高由内容流 + 块级 PageGap spacer + 末页补白 spacer 自然给出（超高块块内不推挤、
          // 连续流过），故 minHeight 只做单页短文的地板；末页尾部补白见下面的 .ws-page-tail。
          style={
            paged
              ? {
                  width: pageBox.paperW,
                  maxWidth: 'none',
                  minHeight: pageBox.paperH,
                  padding: `${pageBox.margin.top}px ${pageBox.margin.right}px ${pageBox.margin.bottom}px ${pageBox.margin.left}px`,
                }
              : undefined
          }
        >
          {/* 模板版式 CSS：已作用域化到 .ws-doc.ws-tpl-on，只作用文档区、不漏 app 界面。 */}
          {scopedTplCss && <style>{scopedTplCss}</style>}
          {/* 标准化排版层 CSS（U3/KTD6）：.ws-doc-paged .ws-p{…} 类级盖过 base 硬编字号/行距。 */}
          {typographyCss && <style>{typographyCss}</style>}
          {!embedded && <DocHeader doc={doc} />}
          <div
            className="ws-blocks"
            onClickCapture={onBlocksClickCapture}
            onMouseOver={onBlocksMouseOver}
            onMouseOut={onBlocksMouseOut}
            onDragOver={onBlocksDragOver}
            onDrop={onBlocksDrop}
            onPaste={onBlocksPaste}
          >
            {doc.blocks.map((b, i) => {
              let edge: 'top' | 'bottom' | null = null
              if (dropIndex === i && dragFrom.current !== null) {
                edge = dragFrom.current < i ? 'bottom' : 'top'
              }
              const gap = paged ? pag?.gaps[i] : null
              return (
                <Fragment key={b.id}>
                  {gap && (
                    <PageGap
                      fill={gap.fill}
                      nextPage={gap.nextPage}
                      box={pageBox}
                      onClick={(e) => routeCaretFromGap(i, e)}
                    />
                  )}
                <BlockRow
                  doc={doc}
                  block={b}
                  index={i}
                  registerEl={registerEl}
                  selected={selectedId === b.id}
                  editing={editingId === b.id}
                  onSelect={selectBlock}
                  onEdit={editAtPoint}
                  onMarkdown={tryMarkdown}
                  onFocusBlock={onFocusBlock}
                  onOpenBlockMenu={openBlockMenu}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onDragEnd={onDragEnd}
                  dropEdge={edge}
                />
                </Fragment>
              )
            })}
            {/* 末页尾部补白：把末页补成整张纸；点它进末块（同 ws-canvas-tail）。 */}
            {paged && pag && pag.tailFill > 0 && (
              <div
                className="ws-page-tail"
                aria-hidden
                style={{ height: pag.tailFill }}
                onClick={enterTail}
              />
            )}
          </div>
          {/* 超高块块内页界（V4）：内容已被真推腾出实体空档，留白遮罩（白底）整段盖上——
              上段=页底留白(fill+页底边距)、中段=灰缝(页码 chip)、下段=页顶留白。白底同时盖住
              超高块自身延续的背景（pre 灰底/表格边框），两页真正断开。pointer-events:none 不碍编辑。 */}
          {paged && pag && pag.gutters.length > 0 && (
            <div className="ws-paged-overlay" aria-hidden>
              {/* 覆盖层原点已是纸的 padding 盒（overlay inset:0）——遮罩水平直接铺满（left/right:0），
                  不能再减页边距（那是块级流内灰缝从内容列外扩用的，这里再减会凸出纸外）。
                  白遮罩不盖纸的左右边线（纸边在留白区要延续）；灰缝各伸出 1px 把边线切断（同块级缝）。 */}
              {pag.gutters.map((g, i) => (
                <div
                  key={i}
                  className="ws-inner-void"
                  style={{
                    top: g.top,
                    height: g.fill + pageBox.margin.bottom + PAGE_GAP_PX + pageBox.margin.top,
                    left: 0,
                    right: 0,
                  }}
                >
                  <div
                    className="ws-page-gutter ws-inner-gutter"
                    style={{
                      height: PAGE_GAP_PX,
                      marginTop: g.fill + pageBox.margin.bottom,
                      marginLeft: -1,
                      marginRight: -1,
                    }}
                  >
                    <span className="ws-page-chip">{t('editor.pageN', { n: g.page })}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="ws-canvas-tail" onClick={enterTail} />
          {!embedded && (
            <div className="ws-doc-end ws-muted">
              {doc.unsaved
                ? t('editor.unsavedNewDoc')
                : t('editor.localHtmlFile', { path: doc.localPath })}
            </div>
          )}
        </article>

        {fmtRect && (
          <FormatToolbar
            rect={fmtRect}
            onCmd={applyCmd}
            onTurnInto={turnInto}
            onAskAI={askAI}
          />
        )}
      </div>

      {aiSoonOpen && <AiSoonModal onClose={() => setAiSoonOpen(false)} />}

      {/* 图片插入的隐藏文件选择器（斜杠菜单「图片」触发；multiple = 一次插多张连续块） */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []).filter((f) =>
            acceptsImageType(f.type),
          )
          const ctx = imagePick.current
          imagePick.current = null
          e.currentTarget.value = '' // 允许连续两次选同一文件
          if (ctx && files.length > 0)
            void insertImages(files, ctx.anchorId, ctx.replaceEmpty)
        }}
      />

      {blockMenuFor && blockMenuPos && (
        <BlockActionMenu
          pos={blockMenuPos}
          blockType={doc.blocks.find((b) => b.id === blockMenuFor)?.type}
          onTurnInto={(type, level) => {
            checkpoint()
            setBlockType(doc.id, blockMenuFor, type, level)
          }}
          onInsertBelow={() => {
            checkpoint()
            editBlock(addBlock(doc.id, blockMenuFor as string, 'text'))
          }}
          onDuplicate={() => {
            checkpoint()
            duplicateBlock(doc.id, blockMenuFor as string)
          }}
          onDelete={() => removeBlock(blockMenuFor as string)}
          onColor={(c) =>
            execOnBlock(blockMenuFor as string, () =>
              document.execCommand('foreColor', false, c),
            )
          }
          onClose={closeBlockMenu}
        />
      )}

      {slash && (
        <SlashMenu
          pos={slash.pos}
          items={filterSlash(slash.query, t).map((it) => ({
            key: it.key,
            label: t(it.label),
          }))}
          activeIndex={slash.active}
          onPick={applySlash}
        />
      )}

      {mention && (
        <MentionMenu
          pos={mention.pos}
          items={mentionItems}
          activeIndex={mention.active}
          query={mention.query}
          onPick={applyMention}
        />
      )}

      {preview && (
        <LinkPreview
          state={preview}
          onKeep={keepPreview}
          onLeave={leavePreview}
          onClose={() => setPreview(null)}
          onRebind={rebindLink}
          onCreate={createAtBroken}
        />
      )}
    </main>
  )
}
