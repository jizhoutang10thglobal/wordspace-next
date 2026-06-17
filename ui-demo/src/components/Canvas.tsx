import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { useStore } from '../mock/store'
import {
  VISIBILITY_META,
  type Block,
  type BlockType,
  type Doc,
} from '../types'
import { Avatar, VisibilityDot } from '../ui/primitives'
import { relTime } from '../lib/format'
import DocMenu from './canvas/DocMenu'
import FormatToolbar, { type FormatRect } from './canvas/FormatToolbar'
import AiSoonModal from './canvas/AiSoonModal'
import BlockActionMenu from './canvas/BlockActionMenu'
import SlashMenu from './canvas/SlashMenu'
import './Canvas.css'

const EDITABLE: BlockType[] = ['heading', 'text', 'list', 'quote', 'callout']
const isEditable = (b: Block) => !b.designed && EDITABLE.includes(b.type)

// 斜杠 `/` 插入菜单的条目（插入块 / 转换块 / AI）。kw 供拼音/英文筛选。
const SLASH_ITEMS: {
  key: string
  label: string
  kw: string
  type: BlockType | 'ai'
  level?: 1 | 2 | 3
}[] = [
  { key: 'text', label: '正文', kw: 'text zhengwen p', type: 'text' },
  { key: 'h1', label: '标题 1', kw: 'h1 biaoti heading', type: 'heading', level: 1 },
  { key: 'h2', label: '标题 2', kw: 'h2 biaoti heading', type: 'heading', level: 2 },
  { key: 'h3', label: '标题 3', kw: 'h3 biaoti heading', type: 'heading', level: 3 },
  { key: 'list', label: '列表', kw: 'list liebiao ul', type: 'list' },
  { key: 'quote', label: '引用', kw: 'quote yinyong', type: 'quote' },
  { key: 'callout', label: '提示', kw: 'callout tishi', type: 'callout' },
  { key: 'divider', label: '分隔线', kw: 'divider hr fengexian', type: 'divider' },
  { key: 'ai', label: '✦ AI 生成（开发中）', kw: 'ai', type: 'ai' },
]
const filterSlash = (q: string) => {
  const s = q.toLowerCase()
  return SLASH_ITEMS.filter(
    (it) => !s || it.label.toLowerCase().includes(s) || it.kw.includes(s),
  )
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
  onFocusBlock: (id: string | null) => void
  onOpenBlockMenu: (id: string, pos: { top: number; left: number }) => void
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
  onDragEnd: () => void
  dropEdge: 'top' | 'bottom' | null
}) {
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const elRef = useRef<HTMLElement | null>(null)
  const debounce = useRef<number | undefined>(undefined)
  const focused = useRef(false)

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
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(persist, 400)
  }
  const handleBlur = () => {
    focused.current = false
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
    inner = <ul className="ws-ul" {...editProps} />
  } else if (block.type === 'quote') {
    inner = <blockquote className="ws-quote" {...editProps} />
  } else {
    inner = <div className="ws-callout" {...editProps} />
  }

  return (
    <div
      className={
        `ws-block${canEdit ? '' : ' ws-block-static'}` +
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
function DocHeader({ doc }: { doc: Doc }) {
  const folder = useStore((s) => s.folders.find((f) => f.id === doc.folderId))
  const editor = useStore((s) => s.getMember(doc.updatedBy))
  const renameDoc = useStore((s) => s.renameDoc)
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
        <span>{folder?.scope === 'team' ? '团队空间' : '我的草稿'}</span>
        <span className="ws-bc-sep">/</span>
        <span>{folder?.name}</span>
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
        <span className="ws-meta-vis">
          <VisibilityDot v={doc.visibility} />
          {v.label}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
export default function Canvas() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const getDoc = useStore((s) => s.getDoc)
  const addBlock = useStore((s) => s.addBlock)
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const reorderBlocks = useStore((s) => s.reorderBlocks)
  const deleteBlock = useStore((s) => s.deleteBlock)
  const setBlockType = useStore((s) => s.setBlockType)
  const duplicateBlock = useStore((s) => s.duplicateBlock)

  const tab = tabs.find((x) => x.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined

  const scrollRef = useRef<HTMLDivElement>(null)
  const blockEls = useRef<Map<string, HTMLElement>>(new Map())
  const focusedBlockId = useRef<string | null>(null)

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
      if (doc.blocks.length <= 1) {
        updateBlockHtml(doc.id, id, '')
        setBlockType(doc.id, id, 'text')
        editBlock(id, { mode: 'start' })
      } else {
        deleteBlock(doc.id, id)
        deselect()
      }
    },
    [doc, updateBlockHtml, setBlockType, editBlock, deleteBlock, deselect],
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
      const el = blockEls.current.get(slash.blockId)
      const empty = !el || (el.textContent ?? '').trim() === ''
      if (it.type === 'divider' || it.type === 'image') {
        selectBlock(addBlock(doc.id, slash.blockId, it.type))
      } else if (empty) {
        setBlockType(doc.id, slash.blockId, it.type, it.level)
      } else {
        editBlock(addBlock(doc.id, slash.blockId, it.type))
      }
    },
    [doc, slash, addBlock, setBlockType, selectBlock, editBlock],
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
      // Enter：可编辑块末尾 → 新建正文块（IME 组词 / Shift 软换行 / list / 中间 各自交还原生）
      if (e.key === 'Enter' && editingId && doc) {
        if (e.isComposing || e.keyCode === 229) return // 中文/日文输入法组词中 = 确认候选词
        if (e.shiftKey) return // 软换行
        const el = blockEls.current.get(editingId)
        const blk = doc.blocks.find((b) => b.id === editingId)
        if (!el || !blk || blk.type === 'list') return // list 内 Enter 交原生（新 <li>）
        if (!isCaretAtBlockEnd(el)) return // 光标在中间 → 原生换行（本期不分裂）
        e.preventDefault()
        editBlock(addBlock(doc.id, editingId, 'text'), { mode: 'start' })
        return
      }
      // 灰选中态按 Enter：在选中块后插正文块并进编辑（兜底，可在不可编辑块后插块）
      if (e.key === 'Enter' && selectedId && !editingId && doc) {
        if (e.isComposing || e.keyCode === 229) return
        e.preventDefault()
        editBlock(addBlock(doc.id, selectedId, 'text'), { mode: 'start' })
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
        const it = filterSlash(slash.query)[slash.active]
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
                  Math.min(s.active + 1, filterSlash(s.query).length - 1),
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
  }, [slash, editingId, doc?.id, applySlash])

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
      const saved = hasText ? sel!.getRangeAt(0).cloneRange() : null
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

  const turnInto = (type: BlockType, level?: 1 | 2 | 3) => {
    if (!selectedId) return
    setBlockType(doc.id, selectedId, type, level)
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
    <main className="ws-canvas">
      {/* 点空白处（非任何块）取消选中——块的 onClick 会 stopPropagation，故此处只接到空白点击 */}
      <div
        className="ws-canvas-scroll"
        ref={scrollRef}
        onClick={deselect}
      >
        <article className={`ws-doc ws-doc-${doc.kind}`}>
          <DocHeader doc={doc} />
          <div className="ws-blocks">
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
                editBlock(addBlock(doc.id, last ? last.id : '', 'text'), {
                  mode: 'start',
                })
              }
            }}
          />
          <div className="ws-doc-end ws-muted">
            这是一个本地 HTML 文件 · {doc.localPath}
          </div>
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
          onTurnInto={(type, level) =>
            setBlockType(doc.id, blockMenuFor, type, level)
          }
          onInsertBelow={() =>
            editBlock(addBlock(doc.id, blockMenuFor as string, 'text'))
          }
          onDuplicate={() => duplicateBlock(doc.id, blockMenuFor as string)}
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
          items={filterSlash(slash.query).map((it) => ({
            key: it.key,
            label: it.label,
          }))}
          activeIndex={slash.active}
          onPick={applySlash}
        />
      )}
    </main>
  )
}
