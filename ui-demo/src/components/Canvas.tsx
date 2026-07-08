import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI, anyOverlayOpen } from '../mock/ui'
import { IS_MAC } from '../lib/platform'
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
import { usePageConfig } from '../mock/paged'
import { computeBoundaries, pageBoxPx } from '../lib/page'
import { getDragFile } from './ArcSidebar'
import type { FileEntry } from '../types'
import './Canvas.css'

const EDITABLE: BlockType[] = ['heading', 'text', 'list', 'quote', 'callout']
const isEditable = (b: Block) => !b.designed && EDITABLE.includes(b.type)

// 斜杠 `/` 插入菜单的条目（插入块 / 转换块 / AI）。kw 供拼音/英文筛选。
const SLASH_ITEMS: {
  key: string
  label: string
  kw: string
  type: BlockType | 'ai' | 'doclink'
  level?: 1 | 2 | 3
  listStyle?: ListStyle
}[] = [
  { key: 'text', label: '正文', kw: 'text zhengwen p', type: 'text' },
  { key: 'h1', label: '标题 1', kw: 'h1 biaoti heading', type: 'heading', level: 1 },
  { key: 'h2', label: '标题 2', kw: 'h2 biaoti heading', type: 'heading', level: 2 },
  { key: 'h3', label: '标题 3', kw: 'h3 biaoti heading', type: 'heading', level: 3 },
  { key: 'list', label: '无序列表', kw: 'list liebiao ul bulleted wuxu', type: 'list', listStyle: 'bulleted' },
  { key: 'numbered', label: '编号列表', kw: 'numbered ordered ol bianhao youxu 1', type: 'list', listStyle: 'numbered' },
  { key: 'todo', label: '待办列表', kw: 'todo task checkbox daiban checklist', type: 'list', listStyle: 'todo' },
  // 互链的可发现入口①：斜杠菜单。位置放在列表之后（第 8 项）——放最后会掉出菜单可视区、
  // 用户根本看不见（Colin 实测「没找到」的直接原因）。历史注释说「下标引用只能 append」已核实过时：
  // 全仓只有 .filter / .find(key)，无下标引用，重排安全。
  { key: 'doclink', label: '🔗 链接到文档', kw: 'link doclink lianjie wendang mention at @', type: 'doclink' },
  { key: 'quote', label: '引用', kw: 'quote yinyong', type: 'quote' },
  { key: 'callout', label: '提示', kw: 'callout tishi', type: 'callout' },
  { key: 'divider', label: '分隔线', kw: 'divider hr fengexian', type: 'divider' },
  // 分页符：仅分页文档开启时出现在菜单（filterSlash 按 pagedOn 过滤）
  { key: 'pagebreak', label: '分页符', kw: 'pagebreak page break fenye fenyefu', type: 'pagebreak' },
  { key: 'ai', label: '✦ AI 生成（开发中）', kw: 'ai', type: 'ai' },
]
const filterSlash = (q: string, pagedOn: boolean) => {
  const s = q.toLowerCase()
  return SLASH_ITEMS.filter(
    (it) =>
      (pagedOn || it.type !== 'pagebreak') &&
      (!s || it.label.toLowerCase().includes(s) || it.kw.includes(s)),
  )
}

// 行首 markdown 前缀 → 目标块类型。仅当块内容正好是「前缀 + 一个空格」时触发
// （用户在空行敲前缀+空格的瞬间），避免误转已有正文。
function detectMarkdown(
  text: string,
): { type: BlockType; level?: 1 | 2 | 3; listStyle?: ListStyle } | null {
  const m = text.match(/^(#{1,3}|[-*]|1\.|\[\s?\]|>)[\s ]$/)
  if (!m) return null
  const t = m[1]
  if (t[0] === '#') return { type: 'heading', level: t.length as 1 | 2 | 3 }
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
    if (el) updateBlockHtml(doc.id, block.id, el.innerHTML)
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
  } else if (block.type === 'pagebreak') {
    // 分页符：虚线 + 居中小标签。不可编辑（同 divider 交互：单击块选中、Delete 删除、可拖拽）。
    inner = (
      <div
        className="ws-pagebreak"
        ref={(el) => registerEl(block.id, el)}
        contentEditable={false}
      >
        <span className="ws-pagebreak-label">分页符</span>
      </div>
    )
  } else if (block.type === 'divider') {
    inner = <hr className="ws-hr" ref={(el) => registerEl(block.id, el)} />
  } else if (block.type === 'image') {
    inner = (
      <div className="ws-image" ref={(el) => registerEl(block.id, el)}>
        {block.html}
      </div>
    )
  } else if (block.type === 'heading') {
    const L = `h${block.level ?? 2}` as 'h1' | 'h2' | 'h3'
    inner = <L className={`ws-h ws-h${block.level ?? 2}`} {...editProps} />
  } else if (block.type === 'text') {
    inner = (
      <p className="ws-p" data-placeholder="输入正文,或按 / 插入" {...editProps} />
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
          title="拖动重排 · 点击打开菜单"
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

// ---------------------------------------------------------------------------
// Header: breadcrumb, meta, and the "…" menu (export / link / rename / delete)
// ---------------------------------------------------------------------------
export function DocHeader({ doc }: { doc: Doc }) {
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
          <span>{doc.unsaved ? '未保存的草稿' : '文档'}</span>
        )}
        <div className="ws-doc-more">
          <button
            className="ws-icon-btn"
            title="更多"
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
          {editor?.name} 编辑于 {relTime(doc.updatedAt)}
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

  // ===== 分页文档（可视分页线路线，不做真物理切页）=====
  const pageCfg = usePageConfig(doc?.id)
  const paged = !!doc && pageCfg.on
  const pageBox = useMemo(() => pageBoxPx(pageCfg), [pageCfg])
  const articleRef = useRef<HTMLElement | null>(null)
  const [pageBounds, setPageBounds] = useState<number[]>([])

  const docFindOpen = useUI((s) => s.docFindOpen)
  const closeDocFind = useUI((s) => s.closeDocFind)

  const scrollRef = useRef<HTMLDivElement>(null)
  const blockEls = useRef<Map<string, HTMLElement>>(new Map())
  const focusedBlockId = useRef<string | null>(null)

  // 分页点重算：内容 / 窗口变化（ResizeObserver）→ rAF 合帧 → computeBoundaries。
  // 显式分页符处强制切页、并从该点重新累计页高（语义在 lib/page.ts，纯函数）。
  useEffect(() => {
    if (!paged || !doc) {
      setPageBounds([])
      return
    }
    const el = articleRef.current
    if (!el) return
    let raf = 0
    const recalc = () => {
      raf = 0
      const rect = el.getBoundingClientRect()
      // 纸的 padding 即页边距 → 内容总高 = padding 盒高度 - 上下边距
      const totalH = el.clientHeight - pageBox.margin.top - pageBox.margin.bottom
      const breakTops: number[] = []
      for (const b of doc.blocks) {
        if (b.type !== 'pagebreak') continue
        const be = blockEls.current.get(b.id)
        const host = (be?.closest('.ws-block') as HTMLElement | null) ?? be
        if (host)
          breakTops.push(
            host.getBoundingClientRect().top - rect.top - pageBox.margin.top,
          )
      }
      setPageBounds(computeBoundaries(totalH, pageBox.contentH, breakTops))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(recalc)
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [paged, doc, pageBox])

  const [fmtRect, setFmtRect] = useState<FormatRect | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
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
        el.focus()
        const sel = window.getSelection()
        if (!sel) return
        let range: Range | null = null
        if (caret.mode === 'point' && caret.x != null && caret.y != null) {
          const pt = caretRangeAtPoint(caret.x, caret.y)
          if (pt && el.contains(pt.startContainer)) range = pt // 落点须在块内，否则回退块末
        }
        if (!range) {
          range = document.createRange()
          range.selectNodeContents(el)
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
      checkpoint()
      const el = blockEls.current.get(slash.blockId)
      const empty = !el || (el.textContent ?? '').trim() === ''
      if (it.type === 'divider' || it.type === 'image' || it.type === 'pagebreak') {
        selectBlock(addBlock(doc.id, slash.blockId, it.type))
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
    if (q) out.push({ key: 'create', title: `新建「${mention.query.trim()}」`, create: true })
    out.push({ key: 'url', title: '网址链接…', url: true })
    return out
  }, [mention, files, docs, curRootId, curPath])

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
        const url = window.prompt('链接地址', 'https://')
        if (!url) return
        externalUrl = url
        title = url
      } else if (key === 'create') {
        // 新建在当前文档同目录（Typora 式的文件原生答案）；不切走当前标签页（Notion 同款）
        title = m.query.trim() || '无标题文档'
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
        if (key === 'create') toast(`已新建「${title}」并链接`, 'success')
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
        const trigs = m.trig === 1 ? ['@', '＠'] : ['[[', '【【']
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
        toast(`已新建「${title}」`, 'success', {
          label: '打开',
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
      const el = blockEls.current.get(editingId)
      if (!el || !(target instanceof Node) || !el.contains(target)) return
      const two = textBeforeCaret(el, 2)
      const one = two.slice(-1)
      let trig = 0
      if (two === '[[' || two === '【【') trig = 2
      else if (one === '@' || one === '＠') trig = 1
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
      if (!f || !curRootId || !curPath || f.rootId !== curRootId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
    },
    [curRootId, curPath],
  )
  const onBlocksDrop = useCallback(
    (e: React.DragEvent) => {
      const f = getDragFile()
      if (!f || !doc) return
      if (!curRootId || !curPath) return
      if (f.rootId !== curRootId) {
        // 跨根不支持（相对路径算不出来）——但要**说出来**，静默没反应会让人以为功能不存在
        e.preventDefault()
        e.stopPropagation()
        toast('跨文件夹的链接暂不支持——把文件拖进同一个文件夹的文档里', 'neutral')
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
          toast('这篇文档没有可放链接的文字块', 'neutral')
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
    [doc, curRootId, curPath, docs, checkpoint, updateBlockHtml, toast],
  )

  // 断链修复①：重新指向候选文件（改这一条链接的 href，落库该块）
  const rebindLink = useCallback(
    (candidate: FileEntry) => {
      if (!doc || !preview || !curPath) return
      if (!document.contains(preview.anchor)) {
        // anchor 已 detach（文档切换/块重渲）——别对着空气改还报成功
        toast('链接已不在当前文档，未能重新指向', 'danger')
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
      toast(`已重新指向 ${candidate.path}`, 'success')
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
    if (p) toast(`已新建「${title}${isMd ? '.md' : ''}」`, 'success')
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
      if (e.key === 'Enter' && editingId && doc) {
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
        e.preventDefault()
        checkpoint()
        editBlock(addBlock(doc.id, selectedId, 'text'), { mode: 'start' })
        return
      }
      // Tab / Shift-Tab：仅在列表内做缩进/反缩进（嵌套子列表，沿用本块的 ul/ol + 样式 class）；
      // 其他块也吞掉 Tab，避免它把光标跳出编辑区。
      if (e.key === 'Tab' && editingId && doc) {
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
      if (e.key === 'Backspace' && editingId && doc) {
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
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && editingId && doc) {
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
        const it = filterSlash(slash.query, paged)[slash.active]
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
                  Math.min(s.active + 1, filterSlash(s.query, paged).length - 1),
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
  }, [slash, mention, editingId, doc?.id, applySlash, paged])

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
        <div className="ws-empty">从左侧选择一篇文档,或新建一篇。</div>
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
      const url = window.prompt('链接地址', 'https://')
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
            (paged ? ' ws-doc-paged' : '')
          }
          // 分页视图：纸宽 = 纸张 px 宽，padding = 页边距（内容列自然收窄为页内容宽）
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
          {!embedded && <DocHeader doc={doc} />}
          <div
            className="ws-blocks"
            onClickCapture={onBlocksClickCapture}
            onMouseOver={onBlocksMouseOver}
            onMouseOut={onBlocksMouseOut}
            onDragOver={onBlocksDragOver}
            onDrop={onBlocksDrop}
          >
            {doc.blocks.map((b, i) => {
              let edge: 'top' | 'bottom' | null = null
              if (dropIndex === i && dragFrom.current !== null) {
                edge = dragFrom.current < i ? 'bottom' : 'top'
              }
              return (
                <BlockRow
                  key={b.id}
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
              )
            })}
          </div>
          <div
            className="ws-canvas-tail"
            onClick={(e) => {
              e.stopPropagation()
              const last = doc.blocks[doc.blocks.length - 1]
              const lastEl = last && blockEls.current.get(last.id)
              if (
                last &&
                isEditable(last) &&
                (lastEl?.textContent ?? '').trim() === ''
              ) {
                editBlock(last.id, { mode: 'end' }) // 末块已是空可编辑块，直接进它
              } else {
                checkpoint()
                editBlock(addBlock(doc.id, last ? last.id : '', 'text'), {
                  mode: 'start',
                })
              }
            }}
          />
          {/* 分页线覆盖层：每个分页点一条横贯纸面的虚线 + 右侧「第 N 页」chip。
              绝对定位不占布局；相对纸张 padding 盒定位（top = 上边距 + 分页点 y）。 */}
          {paged && pageBounds.length > 0 && (
            <div className="ws-page-marks" aria-hidden contentEditable={false}>
              {pageBounds.map((y, i) => (
                <div
                  key={i}
                  className="ws-page-mark"
                  style={{ top: pageBox.margin.top + y }}
                >
                  <span className="ws-page-chip">第 {i + 2} 页</span>
                </div>
              ))}
            </div>
          )}
          {!embedded && (
            <div className="ws-doc-end ws-muted">
              {doc.unsaved
                ? '未保存的新文档 · ⌘S（或右上角「保存」）存进当前空间'
                : `这是一个本地 HTML 文件 · ${doc.localPath}`}
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

      {blockMenuFor && blockMenuPos && (
        <BlockActionMenu
          pos={blockMenuPos}
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
          items={filterSlash(slash.query, paged).map((it) => ({
            key: it.key,
            label: it.label,
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
