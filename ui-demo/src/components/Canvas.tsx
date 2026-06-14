import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  GripVertical,
  Plus,
  Sparkles,
  ArrowUp,
  MoreHorizontal,
} from 'lucide-react'
import { useStore } from '../mock/store'
import {
  VISIBILITY_META,
  type Block,
  type BlockType,
  type Doc,
} from '../types'
import { Avatar, VisibilityDot, Spinner } from '../ui/primitives'
import { relTime } from '../lib/format'
import BlockAddMenu from './canvas/BlockAddMenu'
import DocMenu from './canvas/DocMenu'
import FormatToolbar, { type FormatRect } from './canvas/FormatToolbar'
import CollabCursors from './canvas/CollabCursors'
import './Canvas.css'

const EDITABLE: BlockType[] = ['heading', 'text', 'list', 'quote', 'callout']
const isEditable = (b: Block) => !b.designed && EDITABLE.includes(b.type)

// ---------------------------------------------------------------------------
// One editable / static block, with hover handle + add button + drag source.
// ---------------------------------------------------------------------------
function BlockRow({
  doc,
  block,
  index,
  registerEl,
  onFocusBlock,
  addOpen,
  onToggleAdd,
  onPickAdd,
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
  onFocusBlock: (id: string | null) => void
  addOpen: boolean
  onToggleAdd: (id: string) => void
  onPickAdd: (type: BlockType) => void
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
  onDragEnd: () => void
  dropEdge: 'top' | 'bottom' | null
}) {
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const deleteBlock = useStore((s) => s.deleteBlock)
  const elRef = useRef<HTMLElement | null>(null)
  const debounce = useRef<number | undefined>(undefined)
  const focused = useRef(false)

  const editable = isEditable(block)

  // Set DOM content from the store only when not actively editing, so we never
  // fight the caret. Covers external mutations (AI redesign, reorder reuse).
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
    // Keep this block as the "last focused" target so the AI bar can act on it
    // even after the input steals focus; it's only cleared if the block is gone.
  }

  const handleFocus = () => {
    focused.current = true
    onFocusBlock(block.id)
  }

  // editable element rendered with the right tag, content set imperatively
  const editProps = {
    ref: setNode as never,
    contentEditable: true,
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
      <p className="ws-p" data-placeholder="空段落,输入正文…" {...editProps} />
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
      className={`ws-block${editable ? '' : ' ws-block-static'}${
        dropEdge ? ` ws-block-drop-${dropEdge}` : ''
      }`}
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
          title="拖动以重新排序"
          draggable
          onDragStart={() => onDragStart(index)}
          onDragEnd={onDragEnd}
        >
          <GripVertical size={15} strokeWidth={1.8} />
        </span>
        <span
          className="ws-block-add"
          title="在下方插入"
          onClick={() => onToggleAdd(block.id)}
        >
          <Plus size={14} strokeWidth={1.8} />
        </span>
        {addOpen && (
          <BlockAddMenu
            onPick={onPickAdd}
            onClose={() => onToggleAdd(block.id)}
          />
        )}
      </div>

      {inner}

      <button
        className="ws-block-del"
        title="删除此块"
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteBlock(doc.id, block.id)}
      >
        ×
      </button>
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
  const redesignBlock = useStore((s) => s.redesignBlock)
  const aiBusy = useStore((s) => s.aiBusy)

  const tab = tabs.find((x) => x.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined

  const scrollRef = useRef<HTMLDivElement>(null)
  const blockEls = useRef<Map<string, HTMLElement>>(new Map())
  const focusedBlockId = useRef<string | null>(null)

  const [addMenuFor, setAddMenuFor] = useState<string | null>(null)
  const [fmtRect, setFmtRect] = useState<FormatRect | null>(null)
  const [aiInput, setAiInput] = useState('')
  // flip after first paint so children receive the real scroll element (the
  // ref is null on the initial render that mounts it)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // drag-to-reorder
  const dragFrom = useRef<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) blockEls.current.set(id, el)
    else blockEls.current.delete(id)
  }, [])

  const getBlockEl = useCallback(
    (id: string) => blockEls.current.get(id) ?? null,
    [],
  )

  const focusBlock = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = blockEls.current.get(id)
      if (!el) return
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [])

  // --- inline format toolbar: follow the live selection inside this doc ----
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection()
      const root = scrollRef.current
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) {
        setFmtRect(null)
        return
      }
      const range = sel.getRangeAt(0)
      const anchor = range.startContainer.parentElement
      const inEditable = anchor?.closest('[contenteditable="true"]')
      if (!inEditable || !root.contains(inEditable)) {
        setFmtRect(null)
        return
      }
      const r = range.getBoundingClientRect()
      const sr = root.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) {
        setFmtRect(null)
        return
      }
      setFmtRect({
        top: r.top - sr.top + root.scrollTop - 44,
        left: r.left - sr.left + r.width / 2,
      })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [doc?.id])

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

  const onFocusBlock = (id: string | null) => {
    focusedBlockId.current = id
  }

  // insert a block after `afterId` and focus it
  const handleAdd = (afterId: string, type: BlockType) => {
    setAddMenuFor(null)
    const newId = addBlock(doc.id, afterId, type)
    if (type !== 'divider') focusBlock(newId)
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
    // Dropping on row `to` moves the dragged block into that slot; the store's
    // splice (remove `from`, insert at `to`) implements exactly that.
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

  // --- AI command bar ---
  const submitAI = async () => {
    const prompt = aiInput.trim()
    if (!prompt || aiBusy) return
    setAiInput('')
    const target = focusedBlockId.current
    const targetExists = !!target && doc.blocks.some((b) => b.id === target)
    if (target && targetExists) {
      await redesignBlock(doc.id, target, prompt)
    } else {
      const newId = addBlock(doc.id, null, 'text')
      updateBlockHtml(
        doc.id,
        newId,
        `根据「${prompt}」生成的一段内容。你可以直接编辑这段文字,或选中后再让 AI 调整。`,
      )
      focusBlock(newId)
    }
  }

  return (
    <main className="ws-canvas">
      <div className="ws-canvas-scroll" ref={scrollRef}>
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
                  onFocusBlock={onFocusBlock}
                  addOpen={addMenuFor === b.id}
                  onToggleAdd={(id) =>
                    setAddMenuFor((cur) => (cur === id ? null : id))
                  }
                  onPickAdd={(type) => handleAdd(b.id, type)}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onDragEnd={onDragEnd}
                  dropEdge={edge}
                />
              )
            })}
          </div>
          <div className="ws-doc-end ws-muted">
            这是一个本地 HTML 文件 · {doc.localPath}
          </div>
        </article>

        {fmtRect && (
          <FormatToolbar rect={fmtRect} onApplied={persistFocused} />
        )}

        <CollabCursors
          doc={doc}
          scrollEl={mounted ? scrollRef.current : null}
          getBlockEl={getBlockEl}
        />
      </div>

      <div className="ws-aibar">
        <div className={`ws-aibar-inner${aiBusy ? ' is-busy' : ''}`}>
          {aiBusy ? (
            <Spinner size={16} />
          ) : (
            <Sparkles size={16} className="ws-aibar-spark" />
          )}
          <input
            value={aiInput}
            disabled={aiBusy}
            placeholder={
              aiBusy
                ? '正在生成…'
                : focusedBlockId.current
                  ? '让 AI 重排当前这一块,例如“做成横幅”'
                  : '让 AI 生成或修改这一页,例如“补一段结论”'
            }
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAI()
            }}
          />
          <button
            className="ws-aibar-send"
            disabled={aiBusy || !aiInput.trim()}
            onClick={submitAI}
          >
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </main>
  )
}
