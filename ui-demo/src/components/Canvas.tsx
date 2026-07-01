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
  isCloudStorage,
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
  listStyle?: ListStyle
}[] = [
  { key: 'text', label: '正文', kw: 'text zhengwen p', type: 'text' },
  { key: 'h1', label: '标题 1', kw: 'h1 biaoti heading', type: 'heading', level: 1 },
  { key: 'h2', label: '标题 2', kw: 'h2 biaoti heading', type: 'heading', level: 2 },
  { key: 'h3', label: '标题 3', kw: 'h3 biaoti heading', type: 'heading', level: 3 },
  { key: 'list', label: '无序列表', kw: 'list liebiao ul bulleted wuxu', type: 'list', listStyle: 'bulleted' },
  { key: 'numbered', label: '编号列表', kw: 'numbered ordered ol bianhao youxu 1', type: 'list', listStyle: 'numbered' },
  { key: 'todo', label: '待办列表', kw: 'todo task checkbox daiban checklist', type: 'list', listStyle: 'todo' },
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
function DocHeader({ doc }: { doc: Doc }) {
  const folder = useStore((s) => s.folders.find((f) => f.id === doc.folderId))
  const editor = useStore((s) => s.getMember(doc.updatedBy))
  const renameDoc = useStore((s) => s.renameDoc)
  // In a connected folder there is no Wordspace publish/visibility, and the
  // breadcrumb is the mounted path, not a cloud workspace. null in a cloud space.
  const folderCrumb = useStore((s) => {
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId)
    if (!sp || isCloudStorage(sp.storage)) return null
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    const mount = sp.mountPath ?? (sp.storage === 'gdrive' ? 'Google Drive' : '本地文件夹')
    return t?.url ? `${mount} / ${t.url}` : mount
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
          <>
            <span>{folder?.scope === 'team' ? '团队空间' : '我的草稿'}</span>
            <span className="ws-bc-sep">/</span>
            <span>{folder?.name}</span>
          </>
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

  const tab = tabs.find((x) => x.id === activeTabId)
  const doc = docId ? getDoc(docId) : tab?.docId ? getDoc(tab.docId) : undefined

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
      checkpoint()
      const el = blockEls.current.get(slash.blockId)
      const empty = !el || (el.textContent ?? '').trim() === ''
      if (it.type === 'divider' || it.type === 'image') {
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
      // 撤销 / 重做（Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z）。先 blur 提交并清焦点——否则被聚焦块的
      // contenteditable 不会从 store 重渲染；再 deselect 让恢复的内容贴回 DOM。
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        if (e.shiftKey) redo()
        else undo()
        deselect()
        return
      }
      // 文字格式快捷键 → 复用工具栏现有命令（不新增操作）。仅在有文字选区或选中块时
      // 拦截，否则交还浏览器（光标态的 Cmd+B 等仍走原生）。
      if (e.metaKey || e.ctrlKey) {
        const sel = window.getSelection()
        const hasSel = !!sel && !sel.isCollapsed && sel.rangeCount > 0
        if (hasSel || selectedId) {
          const k = e.key.toLowerCase()
          const cmd =
            e.shiftKey && k === 's'
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

  const turnInto = (type: BlockType, level?: 1 | 2 | 3, listStyle?: ListStyle) => {
    if (!selectedId) return
    const blk = doc.blocks.find((b) => b.id === selectedId)
    if (!blk) return
    checkpoint()
    const wasList = blk.type === 'list'
    const willList = type === 'list'
    // 跨列表边界（段落↔列表）用「新建块替换」而非原地 setBlockType：避免被编辑的
    // contenteditable 在元素重挂时 blur 把旧形态内容写回、污染 <li> 包裹（沿用斜杠菜单做法）。
    if (willList !== wasList) {
      const el = blockEls.current.get(selectedId)
      const live = el ? el.innerHTML : blk.html
      const newId = addBlock(doc.id, selectedId, type, listStyle)
      updateBlockHtml(
        doc.id,
        newId,
        willList ? `<li>${live.trim()}</li>` : unwrapListHtml(live),
      )
      if (!willList && level) setBlockType(doc.id, newId, type, level)
      deleteBlock(doc.id, selectedId)
      editBlock(newId, { mode: 'end' })
      return
    }
    // 同形态（列表样式互换 / 文本类互转）：直接改类型
    setBlockType(doc.id, selectedId, type, level, listStyle)
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
      {/* 点空白处（非任何块）取消选中——块的 onClick 会 stopPropagation，故此处只接到空白点击 */}
      <div
        className="ws-canvas-scroll"
        ref={scrollRef}
        onClick={deselect}
      >
        <article
          className={
            `ws-doc ws-doc-${doc.kind}` +
            (doc.pageFormat ? ` ws-fmt ws-fmt-${doc.pageFormat}` : '')
          }
        >
          {!embedded && <DocHeader doc={doc} />}
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
