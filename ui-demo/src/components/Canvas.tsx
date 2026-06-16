import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Plus,
  Copy,
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
  Trash2,
  Undo2,
  Redo2,
  Square,
  CircleDot,
  Contrast,
  Sparkles,
  ArrowUp,
  MoreHorizontal,
  Type,
  Table,
  Image as ImageIcon,
  Box,
  Minus,
  List,
  Lock,
  Group,
  ChevronUp,
  ChevronsUp,
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
import DocMenu from './canvas/DocMenu'
import './Canvas.css'

const TEXT_TYPES: BlockType[] = ['heading', 'text', 'list', 'quote', 'callout']
const isTextBlock = (b: Block) => !b.designed && TEXT_TYPES.includes(b.type)

type Rect = { top: number; left: number; width: number; height: number }

// ---------------------------------------------------------------------------
// One rendered block. Single click selects (canvas model); double click on a
// text block enters inline edit. Content is set imperatively so we never fight
// the caret while editing.
// ---------------------------------------------------------------------------
function BlockView({
  doc,
  block,
  editing,
  selected,
  registerEl,
  onSelect,
  onEnterEdit,
  onExitEdit,
}: {
  doc: Doc
  block: Block
  editing: boolean
  selected: boolean
  registerEl: (id: string, el: HTMLElement | null) => void
  onSelect: (id: string) => void
  onEnterEdit: (id: string) => void
  onExitEdit: () => void
}) {
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const elRef = useRef<HTMLElement | null>(null)

  const setNode = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el
      registerEl(block.id, el)
      if (el && !editing && el.innerHTML !== block.html) el.innerHTML = block.html
    },
    [block.id, block.html, editing, registerEl],
  )

  useLayoutEffect(() => {
    const el = elRef.current
    if (el && !editing && el.innerHTML !== block.html) el.innerHTML = block.html
  }, [block.html, editing])

  useEffect(() => {
    if (editing) {
      const el = elRef.current
      if (el) {
        el.focus()
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }, [editing])

  const persist = () => {
    const el = elRef.current
    if (el) updateBlockHtml(doc.id, block.id, el.innerHTML)
  }

  const editProps = {
    ref: setNode as never,
    contentEditable: editing,
    suppressContentEditableWarning: true,
    spellCheck: false,
    'data-block': block.id,
    onBlur: () => {
      persist()
      onExitEdit()
    },
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
    inner = <p className="ws-p" data-placeholder="空段落,输入正文…" {...editProps} />
  } else if (block.type === 'list') {
    inner = <ul className="ws-ul" {...editProps} />
  } else if (block.type === 'quote') {
    inner = <blockquote className="ws-quote" {...editProps} />
  } else {
    inner = <div className="ws-callout" {...editProps} />
  }

  return (
    <div
      className={`ws-cblock${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`}
      data-cblock={block.id}
      onMouseDown={(e) => {
        e.stopPropagation() // keep selection/edit alive; don't bubble to stage-deselect
        if (editing) return
        onSelect(block.id)
      }}
      onDoubleClick={(e) => {
        if (isTextBlock(block)) {
          e.stopPropagation()
          onEnterEdit(block.id)
        }
      }}
    >
      {inner}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Doc header (breadcrumb + meta + "…" menu) — unchanged from the block editor.
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
          <button className="ws-icon-btn" title="更多" onClick={() => setMenuOpen((o) => !o)}>
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
// Toolbar — persistent rich toolbar (heyhtml style). Mostly visual; align
// buttons + heading reflect a little state so the chrome feels alive.
// ---------------------------------------------------------------------------
const HANDLE_POS = [
  { l: 0, t: 0 }, { l: 0.5, t: 0 }, { l: 1, t: 0 }, { l: 1, t: 0.5 },
  { l: 1, t: 1 }, { l: 0.5, t: 1 }, { l: 0, t: 1 }, { l: 0, t: 0.5 },
]

const INSERT_ITEMS = [
  { icon: Box, label: '容器' }, { icon: Type, label: '文本' },
  { icon: ChevronUp, label: '标题' }, { icon: Table, label: '表格' },
  { icon: ImageIcon, label: '图片' }, { icon: Square, label: '按钮' },
  { icon: Minus, label: '分隔线' }, { icon: Link2, label: '链接' },
  { icon: List, label: '列表' },
]

// ---------------------------------------------------------------------------
// Canvas — heyhtml free-canvas editor area
// ---------------------------------------------------------------------------
export default function Canvas() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const getDoc = useStore((s) => s.getDoc)
  const addBlock = useStore((s) => s.addBlock)
  const updateBlockHtml = useStore((s) => s.updateBlockHtml)
  const deleteBlock = useStore((s) => s.deleteBlock)
  const redesignBlock = useStore((s) => s.redesignBlock)
  const aiBusy = useStore((s) => s.aiBusy)

  const tab = tabs.find((x) => x.id === activeTabId)
  const doc = tab?.docId ? getDoc(tab.docId) : undefined

  const stageRef = useRef<HTMLDivElement>(null)
  const blockEls = useRef<Map<string, HTMLElement>>(new Map())

  const [mode, setMode] = useState<'edit' | 'view'>('edit')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('left')
  const [insertOpen, setInsertOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [selRect, setSelRect] = useState<Rect | null>(null)
  const [guide, setGuide] = useState<{ x: number; top: number; height: number; gapY: number; gap: number } | null>(null)
  const [aiInput, setAiInput] = useState('')

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) blockEls.current.set(id, el)
    else blockEls.current.delete(id)
  }, [])

  // compute the selection box + an alignment guide for the selected block,
  // all in .ws-stage coordinate space (so it tracks scroll for free).
  const recomputeOverlay = useCallback((id: string | null) => {
    const stage = stageRef.current
    if (!id || !stage) {
      setSelRect(null)
      setGuide(null)
      return
    }
    const el = blockEls.current.get(id)
    if (!el) {
      setSelRect(null)
      setGuide(null)
      return
    }
    const sr = stage.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const pad = 4
    setSelRect({
      left: r.left - sr.left - pad,
      top: r.top - sr.top - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    })
    // alignment guide: left-edge vertical line + vertical gap to the next block
    const ids = doc ? doc.blocks.map((b) => b.id) : []
    const i = ids.indexOf(id)
    const next = i >= 0 && i < ids.length - 1 ? blockEls.current.get(ids[i + 1]) : null
    if (next) {
      const nr = next.getBoundingClientRect()
      const gap = Math.max(0, Math.round(nr.top - r.bottom))
      setGuide({
        x: r.left - sr.left,
        top: r.top - sr.top - 22,
        height: nr.bottom - r.top + 22,
        gapY: r.bottom - sr.top + (nr.top - r.bottom) / 2,
        gap,
      })
    } else {
      setGuide(null)
    }
  }, [doc])

  useLayoutEffect(() => {
    recomputeOverlay(selectedId)
  }, [selectedId, recomputeOverlay, doc?.id])

  useEffect(() => {
    const onResize = () => recomputeOverlay(selectedId)
    window.addEventListener('resize', onResize)
    const stage = stageRef.current?.parentElement
    stage?.addEventListener('scroll', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      stage?.removeEventListener('scroll', onResize)
    }
  }, [selectedId, recomputeOverlay])

  if (!doc) {
    return (
      <main className="ws-canvas ws-canvas-empty">
        <div className="ws-empty">从左侧选择一篇文档,或新建一篇。</div>
      </main>
    )
  }

  const selectedBlock = doc.blocks.find((b) => b.id === selectedId) ?? null
  const headingValue =
    selectedBlock?.type === 'heading' ? `h${selectedBlock.level ?? 2}` : 'p'

  const select = (id: string) => {
    setSelectedId(id)
    setEditingId(null)
    setCtxMenu(null)
    setInsertOpen(false)
  }
  const deselect = () => {
    setSelectedId(null)
    setEditingId(null)
    setCtxMenu(null)
  }

  const onContext = (e: React.MouseEvent) => {
    if (mode === 'view') return
    e.preventDefault()
    const target = (e.target as HTMLElement).closest('[data-cblock]') as HTMLElement | null
    if (target) select(target.dataset.cblock!)
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const submitAI = async () => {
    const prompt = aiInput.trim()
    if (!prompt || aiBusy) return
    setAiInput('')
    if (selectedId && doc.blocks.some((b) => b.id === selectedId)) {
      await redesignBlock(doc.id, selectedId, prompt)
    } else {
      const newId = addBlock(doc.id, null, 'text')
      updateBlockHtml(doc.id, newId, `根据「${prompt}」生成的一段内容。选中任意元素后再让 AI 调整。`)
      select(newId)
    }
  }

  const TB = (icon: React.ReactNode, title: string, opts?: { on?: boolean; danger?: boolean; onClick?: () => void }) => (
    <button
      className={`ws-tb-btn${opts?.on ? ' on' : ''}${opts?.danger ? ' danger' : ''}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={opts?.onClick}
    >
      {icon}
    </button>
  )

  return (
    <main className={`ws-canvas ws-canvas-hey mode-${mode}`}>
      {/* ===== persistent rich toolbar ===== */}
      <div className="ws-edtoolbar">
        <div className="ws-tb-grp">
          {TB(<Bold size={15} />, '加粗 ⌘B')}
          {TB(<Italic size={15} />, '斜体 ⌘I')}
          {TB(<Underline size={15} />, '下划线 ⌘U')}
          {TB(<Strikethrough size={15} />, '删除线')}
        </div>
        <span className="ws-tb-sep" />
        <select className="ws-tb-sel" value={headingValue} title="段落 / 标题" onChange={() => {}}>
          <option value="p">正文</option>
          <option value="h1">标题 1</option>
          <option value="h2">标题 2</option>
          <option value="h3">标题 3</option>
        </select>
        <span className="ws-tb-sep" />
        <div className="ws-tb-grp">
          <select className="ws-tb-sel" title="字体" onChange={() => {}}>
            <option>字体</option><option>无衬线</option><option>衬线</option><option>等宽</option>
          </select>
          <select className="ws-tb-sel" title="字号" onChange={() => {}}>
            <option>16</option><option>14</option><option>18</option><option>24</option><option>32</option>
          </select>
        </div>
        <span className="ws-tb-sep" />
        <div className="ws-tb-grp">
          {TB(<span className="ws-tb-A">A</span>, '文字颜色')}
          {TB(<span className="ws-tb-hi" />, '背景高亮')}
          {TB(<Link2 size={15} />, '链接')}
        </div>
        <span className="ws-tb-sep" />
        <div className="ws-tb-grp">
          {TB(<AlignLeft size={15} />, '左对齐', { on: align === 'left', onClick: () => setAlign('left') })}
          {TB(<AlignCenter size={15} />, '居中', { on: align === 'center', onClick: () => setAlign('center') })}
          {TB(<AlignRight size={15} />, '右对齐', { on: align === 'right', onClick: () => setAlign('right') })}
        </div>
        <span className="ws-tb-sep" />
        <button
          className={`ws-tb-btn ws-tb-text${insertOpen ? ' on' : ''}`}
          title="插入元素"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setInsertOpen((o) => !o); setCtxMenu(null) }}
        >
          <Plus size={15} /> 插入
        </button>
        <span className="ws-tb-sep" />
        <div className="ws-tb-grp">
          {TB(<Copy size={15} />, '复制')}
          {TB(<ArrowUpIcon size={15} />, '上移')}
          {TB(<ArrowDownIcon size={15} />, '下移')}
          {TB(<Trash2 size={15} />, '删除', { danger: true, onClick: () => { if (selectedId) { deleteBlock(doc.id, selectedId); deselect() } } })}
        </div>
        <span className="ws-tb-sep" />
        <div className="ws-tb-grp">
          {TB(<Square size={15} />, '圆角')}
          {TB(<Contrast size={15} />, '阴影')}
          {TB(<CircleDot size={15} />, '不透明度')}
        </div>
        <span className="ws-tb-sep" />
        <div className="ws-tb-grp">
          {TB(<Undo2 size={15} />, '撤销')}
          {TB(<Redo2 size={15} />, '重做')}
        </div>
        <span className="ws-tb-spacer" />
        <div className="ws-tb-seg">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>编辑</button>
          <button className={mode === 'view' ? 'on' : ''} onClick={() => { setMode('view'); deselect() }}>预览</button>
        </div>
      </div>

      {/* ===== canvas workspace ===== */}
      <div className="ws-canvas-workspace">
        <div
          className="ws-stage"
          ref={stageRef}
          onMouseDown={deselect}
          onContextMenu={onContext}
        >
          <article className={`ws-page ws-doc-${doc.kind}`}>
            <DocHeader doc={doc} />
            <div className="ws-blocks">
              {doc.blocks.map((b) => (
                <BlockView
                  key={b.id}
                  doc={doc}
                  block={b}
                  editing={editingId === b.id}
                  selected={selectedId === b.id}
                  registerEl={registerEl}
                  onSelect={select}
                  onEnterEdit={(id) => { setSelectedId(id); setEditingId(id) }}
                  onExitEdit={() => setEditingId(null)}
                />
              ))}
            </div>
            <div className="ws-doc-end ws-muted">这是一个本地 HTML 文件 · {doc.localPath}</div>
          </article>

          {/* selection + handles + alignment guides overlay (edit mode only) */}
          {mode === 'edit' && selRect && (
            <div className="ws-overlay" aria-hidden>
              {guide && (
                <>
                  <span className="ws-guide-v" style={{ left: guide.x, top: guide.top, height: guide.height }} />
                  {guide.gap > 0 && (
                    <span className="ws-dist" style={{ left: guide.x, top: guide.gapY }}>{guide.gap} px</span>
                  )}
                </>
              )}
              <div
                className="ws-selbox"
                style={{ left: selRect.left, top: selRect.top, width: selRect.width, height: selRect.height }}
              >
                <span className="ws-seltag">
                  {selectedBlock?.type === 'heading' ? `标题 ${selectedBlock.level ?? 2}` :
                    selectedBlock?.type === 'image' ? '图片' :
                    selectedBlock?.designed ? '设计块' : '文本'} · {selectedBlock?.type ?? ''}
                </span>
                {HANDLE_POS.map((p, i) => (
                  <span key={i} className="ws-handle" style={{ left: `${p.l * 100}%`, top: `${p.t * 100}%` }} />
                ))}
              </div>
            </div>
          )}

          {/* insert panel popover */}
          {insertOpen && mode === 'edit' && (
            <div className="ws-insertpanel" onMouseDown={(e) => e.stopPropagation()}>
              <div className="ws-ip-ttl">插入元素 <span>双击空白处也可</span></div>
              <div className="ws-ip-modes">
                <button className="on">浮动 Float</button>
                <button>排版流 Flow</button>
              </div>
              <div className="ws-ip-grid">
                {INSERT_ITEMS.map((it) => (
                  <button
                    key={it.label}
                    className="ws-ip-cell"
                    onClick={() => { addBlock(doc.id, selectedId, 'text'); setInsertOpen(false) }}
                  >
                    <it.icon size={17} strokeWidth={1.7} />
                    {it.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== right-click context menu ===== */}
      {ctxMenu && (
        <>
          <div className="ws-ctx-scrim" onMouseDown={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} />
          <div className="ws-ctxmenu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button className="ws-ctx-item" onClick={() => { if (selectedId) setEditingId(selectedId); setCtxMenu(null) }}>编辑文字 <span>双击</span></button>
            <button className="ws-ctx-item"><span className="ws-ci-l"><Copy size={14} /> 复制</span><span>⌘D</span></button>
            <div className="ws-ctx-sep" />
            <button className="ws-ctx-item">复制样式 <span>⌘⇧C</span></button>
            <button className="ws-ctx-item">粘贴样式 <span>⌘⇧V</span></button>
            <div className="ws-ctx-sep" />
            <button className="ws-ctx-item"><span className="ws-ci-l"><ChevronUp size={14} /> 上移一层</span></button>
            <button className="ws-ctx-item"><span className="ws-ci-l"><ChevronsUp size={14} /> 置于顶层</span></button>
            <button className="ws-ctx-item"><span className="ws-ci-l"><Lock size={14} /> 锁定</span><span>⌘L</span></button>
            <button className="ws-ctx-item"><span className="ws-ci-l"><Group size={14} /> 编组</span><span>⌘G</span></button>
            <div className="ws-ctx-sep" />
            <button className="ws-ctx-item danger" onClick={() => { if (selectedId) { deleteBlock(doc.id, selectedId); deselect() } setCtxMenu(null) }}><span className="ws-ci-l"><Trash2 size={14} /> 删除</span><span>⌫</span></button>
          </div>
        </>
      )}

      {/* ===== multi-select toast hint (edit mode, something selected) ===== */}
      {mode === 'edit' && selectedId && (
        <div className="ws-mstoast">
          <span className="ws-mst-cnt">已选中 1 个元素</span>
          <button className="ws-mst-mini">编组</button>
          <button className="ws-mst-mini" onClick={() => { deleteBlock(doc.id, selectedId); deselect() }}>删除</button>
          <span className="ws-mst-hint">⌘ 点击可多选</span>
        </div>
      )}

      {/* ===== AI command bar (wordspace product feature, kept) ===== */}
      <div className="ws-aibar">
        <div className={`ws-aibar-inner${aiBusy ? ' is-busy' : ''}`}>
          {aiBusy ? <Spinner size={16} /> : <Sparkles size={16} className="ws-aibar-spark" />}
          <input
            value={aiInput}
            disabled={aiBusy}
            placeholder={aiBusy ? '正在生成…' : selectedId ? '让 AI 重排选中的元素,例如“做成横幅”' : '让 AI 生成或修改这一页…'}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitAI() }}
          />
          <button className="ws-aibar-send" disabled={aiBusy || !aiInput.trim()} onClick={submitAI}>
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </main>
  )
}
