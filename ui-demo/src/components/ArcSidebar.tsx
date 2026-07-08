import { useRef, useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Lock,
  Globe,
  FolderClosed,
  FileText,
  Plus,
  X,
  Check,
  Bot,
  Settings2,
  Globe2,
  Cloud,
  HardDrive,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File,
  FolderPlus,
  Keyboard,
  Pin,
  PinOff,
  Search,
  AlertCircle,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI, anyOverlayOpen } from '../mock/ui'
import { useBrowser } from '../mock/browser'
import { Avatar } from '../ui/primitives'
import { buildFileTree, compactTree, type FileNode } from '../lib/tree'
import { computeBacklinks, computeDirBacklinks } from '../lib/links'
import { IS_MAC } from '../lib/platform'
import type { FileEntry, FileKind, MountRoot, Tab } from '../types'
import './ArcSidebar.css'

// ---------------------------------------------------------------------------
// Drag and drop. 置顶 and 标签页 both hold tabs, so there is one drag kind: a tab
// dropped into the 置顶 zone becomes pinned, into the 标签页 zone becomes
// unpinned, and within a zone it reorders. getData() is blocked during dragover,
// so the dragged id is stashed module-side. Same-document only.
// ---------------------------------------------------------------------------
let dragTabId: string | null = null

// A file dragged within the tree. Carries the whole entry so a drop can move it
// (preserving docId/kind). Same-space moves only. getData() is blocked during
// dragover, so we stash it module-side, mirroring dragTabId.
let dragFile: FileEntry | null = null
// A root header being dragged to reorder the roots（多文件夹：根的上下顺序自由调整）。
let dragRootId: string | null = null
// The most-recently-hovered drop target's highlight-clear fn, so a cancelled
// drag (Esc) can reset a stuck highlight the dragleave never cleared.
let clearDrop: (() => void) | null = null
/** The parent directory of a file path ('' = mount root). */
function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i) : ''
}

// 文件树缩进:每级 12px(研究:窄侧栏 12-16px,导引线扛层级、缩进就不用大)。
// **不再硬封顶**——封顶会让深层各级挤成同一缩进、层级信息丢失(Wendi 反馈的根因)。深层靠
// compact folders 压有效深度 + 导引线读层级 + 名字省略号/tooltip + 折叠 兜底(VS Code/Notion 同款)。
const INDENT_STEP = 12
// 导引线起点 x:对齐第 0 级 caret 中心(dir base 8 + caret 半宽 ~6)。第 i 级导引线在 GUIDE_X0 + i*STEP。
const GUIDE_X0 = 14
function treeIndent(base: number, depth: number): number {
  return base + depth * INDENT_STEP
}

// 缩进导引线(Obsidian/VS Code 同款):每级祖先一条淡墨竖线,让小缩进也能读出层级。绝对定位在行内
// (行 position:relative),相邻行的线段自然连成通线。颜色=淡墨、非 accent(accent 留给选中,层级/选中提示不打架)。
function IndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) return null
  const lines = []
  for (let i = 0; i < depth; i++) {
    lines.push(<span key={i} className="arc-guide" style={{ left: GUIDE_X0 + i * INDENT_STEP }} aria-hidden />)
  }
  return <>{lines}</>
}

type InsertPos = 'before' | 'after'
/** Where to drop, from cursor Y vs the hovered row's midpoint. */
function insertAt(e: React.DragEvent): InsertPos {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return e.clientY > r.top + r.height / 2 ? 'after' : 'before'
}
/** Final index in a group for "move fromId next to targetId on `pos` side". */
function targetIndex(ids: string[], fromId: string, targetId: string, pos: InsertPos): number {
  const rest = ids.filter((id) => id !== fromId)
  const idx = rest.indexOf(targetId)
  if (idx < 0) return rest.length
  return pos === 'after' ? idx + 1 : idx
}

function TabRow({
  tab,
  insert,
  onRowDragOver,
}: {
  tab: Tab
  insert: InsertPos | null
  onRowDragOver: (e: React.DragEvent) => void
}) {
  const { activeTabId, setActiveTab, closeTab, togglePin } = useStore()
  const active = tab.id === activeTabId
  const pinned = !!tab.pinned
  const unsaved = useStore((s) => {
    const d = tab.docId ? s.docs.find((x) => x.id === tab.docId) : undefined
    return !!d?.unsaved
  })
  const askCloseTab = useUI((s) => s.askCloseTab)
  return (
    <div
      className={`arc-tab ${active ? 'is-active' : ''} ${insert ? 'drop-' + insert : ''}`}
      title={tab.title}
      draggable
      onDragStart={(e) => {
        dragTabId = tab.id
        e.dataTransfer.setData('text/plain', tab.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        dragTabId = null
      }}
      onDragOver={onRowDragOver}
      onClick={() => setActiveTab(tab.id)}
    >
      <span className="arc-tab-ico">
        {tab.kind === 'web' ? <Globe2 size={13} /> : <FileText size={13} />}
      </span>
      <span className="arc-tab-title ws-truncate">{tab.title}</span>
      {unsaved && <span className="arc-tab-dot" title="未保存（还没存进文件夹）" />}
      <button
        className="arc-tab-act"
        title={pinned ? '取消置顶' : '置顶'}
        onClick={(e) => {
          e.stopPropagation()
          togglePin(tab.id)
        }}
      >
        {pinned ? <PinOff size={12} /> : <Pin size={12} />}
      </button>
      {!pinned && (
        <button
          className="arc-tab-act arc-tab-close"
          title="关闭"
          onClick={(e) => {
            e.stopPropagation()
            // 未保存的临时文档 → 弹确认；否则直接关。切换标签页不走这里（不提示）。
            if (unsaved) askCloseTab(tab.id)
            else closeTab(tab.id)
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// One strip for a (pinned?) group of tabs. It is a drop zone: dropping a tab
// here sets its pinned state and positions it where the insertion line was.
function TabStrip({ pinned, emptyHint }: { pinned: boolean; emptyHint?: string }) {
  const allTabs = useStore((s) => s.tabs)
  const dropTab = useStore((s) => s.dropTab)
  const tabs = allTabs.filter((t) => !!t.pinned === pinned)
  const [insert, setInsert] = useState<{ id: string; pos: InsertPos } | null>(null)
  const [zoneOver, setZoneOver] = useState(false)
  const empty = tabs.length === 0

  const onDrop = (e: React.DragEvent) => {
    if (!dragTabId) return
    e.preventDefault()
    const target = insert
    setInsert(null)
    setZoneOver(false)
    const idx = target
      ? targetIndex(tabs.map((t) => t.id), dragTabId, target.id, target.pos)
      : tabs.filter((t) => t.id !== dragTabId).length
    dropTab(dragTabId, pinned, idx)
  }
  return (
    <div
      className={`arc-tabs ${zoneOver ? 'is-drop' : ''}`}
      onDragOver={(e) => {
        if (!dragTabId) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (empty) setZoneOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setInsert(null)
          setZoneOver(false)
        }
      }}
      onDrop={onDrop}
    >
      {empty && emptyHint ? (
        <div className="arc-tabs-empty">{emptyHint}</div>
      ) : (
        tabs.map((t) => (
          <TabRow
            key={t.id}
            tab={t}
            insert={insert?.id === t.id ? insert.pos : null}
            onRowDragOver={(e) => {
              if (!dragTabId || dragTabId === t.id) return
              e.preventDefault()
              setInsert({ id: t.id, pos: insertAt(e) })
            }}
          />
        ))
      )}
    </div>
  )
}

function FileIcon({ kind }: { kind: FileKind }) {
  switch (kind) {
    case 'image':
      return <FileImage size={13} className="arc-file-ico is-image" />
    case 'sheet':
      return <FileSpreadsheet size={13} className="arc-file-ico is-sheet" />
    case 'slides':
      return <Presentation size={13} className="arc-file-ico is-slides" />
    case 'word':
      return <FileText size={13} className="arc-file-ico is-word" />
    case 'pdf':
      return <FileText size={13} className="arc-file-ico is-pdf" />
    case 'html':
      return <FileText size={13} className="arc-file-ico is-html" />
    default:
      return <File size={13} className="arc-file-ico" />
  }
}

// A lightweight Finder-style right-click menu, positioned at the cursor.
function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: { label: string; danger?: boolean; onClick: () => void }[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} className="arc-ctx" style={{ left: x, top: y }}>
      {items.map((it, i) => (
        <button
          key={i}
          className={`arc-ctx-item ${it.danger ? 'is-danger' : ''}`}
          onClick={() => {
            it.onClick()
            onClose()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

// A node in a connected folder. HTML files open in the editor; every other type
// opens a hand-off tab. Files: drag to move, right-click for open/rename/delete.
// Folders: drop target, right-click for new doc / new subfolder / rename / delete.
function FileBranch({
  node,
  depth,
  path,
  rootId,
  forceOpen,
}: {
  node: FileNode
  depth: number
  path: string
  rootId: string
  forceOpen?: boolean
}) {
  const navigate = useNavigate()
  const openFileTab = useStore((s) => s.openFileTab)
  const renameFile = useStore((s) => s.renameFile)
  const deleteFileWithUndo = useStore((s) => s.deleteFileWithUndo)
  const moveFile = useStore((s) => s.moveFile)
  const createSubfolder = useStore((s) => s.createSubfolder)
  const renameDir = useStore((s) => s.renameDir)
  const deleteDirWithUndo = useStore((s) => s.deleteDirWithUndo)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const openState = useUI((s) => !s.collapsedKeys[`file:${rootId}:${path}`])
  const open = forceOpen || openState
  const toggle = useUI((s) => s.toggleCollapsed)
  const openCreate = useUI((s) => s.openCreate)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [dropOver, setDropOver] = useState(false)
  const cancelRename = useRef(false)

  // ---------- file leaf ----------
  if (node.file) {
    const f = node.file
    const activeTab = tabs.find((t) => t.id === activeTabId)
    const isActive = !!activeTab?.fileName && activeTab.rootId === f.rootId && activeTab.url === f.path
    const foreign = f.kind !== 'html'
    const dot = node.name.lastIndexOf('.')
    const baseName = dot > 0 ? node.name.slice(0, dot) : node.name
    const openIt = () => {
      openFileTab(f)
      navigate('/docs')
    }

    if (renaming) {
      return (
        <div className="arc-file" style={{ paddingLeft: treeIndent(26, depth) }}>
          <FileIcon kind={f.kind} />
          <input
            className="arc-file-rename"
            autoFocus
            defaultValue={baseName}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              if (!cancelRename.current) renameFile(f, e.currentTarget.value)
              cancelRename.current = false
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                cancelRename.current = true
                e.currentTarget.blur()
              }
            }}
          />
        </div>
      )
    }
    return (
      <>
        <button
          className={`arc-file ${isActive ? 'is-active' : ''} ${foreign ? 'is-foreign' : ''}`}
          style={{ paddingLeft: treeIndent(26, depth) }}
          title={node.name}
          draggable
          onDragStart={(e) => {
            dragFile = f
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', f.path)
          }}
          onDragEnd={() => {
            dragFile = null
            clearDrop?.() // reset a stuck drop-highlight on cancel (Esc) / drop-end
            clearDrop = null
          }}
          onClick={openIt}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          <IndentGuides depth={depth} />
          <FileIcon kind={f.kind} />
          <span className="ws-truncate">{node.name}</span>
        </button>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              { label: '打开', onClick: openIt },
              { label: '重命名', onClick: () => setRenaming(true) },
              {
                label: '删除',
                danger: true,
                onClick: () => {
                  // 互链守卫：有反链的文件删除前弹确认（列出谁链接到它），没有就直接删（保留 toast 撤销）
                  const s = useStore.getState()
                  const n = computeBacklinks(s.files, s.docs, f.rootId, f.path).length
                  if (n > 0) useUI.getState().askDeleteFile('file', f.rootId, f.path, n)
                  else deleteFileWithUndo(f)
                },
              },
            ]}
          />
        )}
      </>
    )
  }

  // ---------- directory ----------
  if (renaming) {
    return (
      <div className="arc-file" style={{ paddingLeft: treeIndent(8, depth) }}>
        <FolderClosed size={13} className="arc-file-ico" />
        <input
          className="arc-file-rename"
          autoFocus
          defaultValue={node.name}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            if (!cancelRename.current) renameDir(rootId, path, e.currentTarget.value)
            cancelRename.current = false
            setRenaming(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              cancelRename.current = true
              e.currentTarget.blur()
            }
          }}
        />
      </div>
    )
  }
  // open the create modal (template picker) targeting this folder
  const newDocHere = () => openCreate({ rootId, dir: path })
  return (
    <div className="arc-tree-dir">
      <div
        className={`arc-folder-head ${dropOver ? 'is-drop' : ''}`}
        role="button"
        tabIndex={0}
        title={node.name}
        // sticky ancestor：每级祖先 top=depth*30 逐级吸顶堆叠；z 越浅越高（退出时浅层盖深层、干净）
        style={{ paddingLeft: treeIndent(8, depth), top: depth * 30, zIndex: 20 - Math.min(depth, 15) }}
        onClick={() => toggle(`file:${rootId}:${path}`)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle(`file:${rootId}:${path}`)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          // skip if no file dragged, cross-root, or already in this folder
          if (!dragFile || dragFile.rootId !== rootId || parentDir(dragFile.path) === path) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          clearDrop = () => setDropOver(false)
          setDropOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false)
        }}
        onDrop={(e) => {
          if (!dragFile || dragFile.rootId !== rootId) return
          e.preventDefault()
          e.stopPropagation()
          setDropOver(false)
          clearDrop = null
          moveFile(dragFile, path)
        }}
      >
        <IndentGuides depth={depth} />
        <ChevronRight size={12} className={`arc-caret ${open ? 'is-open' : ''}`} />
        <FolderClosed size={13} />
        <span className="ws-truncate arc-folder-name">
          {node.name.split('/').map((seg, i) => (
            <span key={i}>
              {i > 0 && <span className="arc-seg-sep">/</span>}
              {seg}
            </span>
          ))}
        </span>
        <button
          className="arc-folder-add"
          title="在此文件夹新建文档"
          onClick={(e) => {
            e.stopPropagation()
            newDocHere()
          }}
        >
          <Plus size={13} />
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: '新建文档', onClick: newDocHere },
            { label: '新建子文件夹', onClick: () => createSubfolder(rootId, path) },
            { label: '重命名', onClick: () => setRenaming(true) },
            {
              label: '删除',
              danger: true,
              onClick: () => {
                // 互链守卫（文件夹版）：夹外文档链接着夹内文件时先确认（夹内互链一起删、不算断链）
                const s = useStore.getState()
                const n = computeDirBacklinks(s.files, s.docs, rootId, path).length
                if (n > 0) useUI.getState().askDeleteFile('dir', rootId, path, n)
                else deleteDirWithUndo(rootId, path)
              },
            },
          ]}
        />
      )}
      {open &&
        (node.children.length ? (
          node.children.map((c, i) => (
            <FileBranch
              key={i}
              node={c}
              depth={depth + 1}
              path={`${path}/${c.name}`}
              rootId={rootId}
              forceOpen={forceOpen}
            />
          ))
        ) : (
          <div className="arc-tree-empty" style={{ paddingLeft: treeIndent(26, depth + 1) }}>
            空文件夹
          </div>
        ))}
    </div>
  )
}

// One opened folder's section in the library: a collapsible root header (folder
// name; hover shows the full path; right-click to manage) + its own file tree,
// indented inside a rail. The header is (a) the "drop file here to move to this
// root's top level" target and (b) draggable itself, to reorder roots（顺序持久化）。
function RootSection({ root, index, query }: { root: MountRoot; index: number; query: string }) {
  const files = useStore((s) => s.files)
  const dirs = useStore((s) => s.dirs)
  const moveFile = useStore((s) => s.moveFile)
  const removeRoot = useStore((s) => s.removeRoot)
  const reorderRoots = useStore((s) => s.reorderRoots)
  const relocateRoot = useStore((s) => s.relocateRoot)
  const openCreate = useUI((s) => s.openCreate)
  const key = 'root:' + root.id
  const openState = useUI((s) => !s.collapsedKeys[key])
  const toggle = useUI((s) => s.toggleCollapsed)
  const q = query.trim().toLowerCase()
  const open = q ? true : openState
  const [rootDrop, setRootDrop] = useState(false)
  const [insert, setInsert] = useState<InsertPos | null>(null) // 根重排的插入线位置
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // 失联根：底层文件夹不可达。灰显 header + 「重新定位 / 移除」，不渲染树；筛选时直接跳过。
  if (root.missing) {
    if (q) return null
    return (
      <div className="arc-root is-missing">
        <div
          className="arc-root-head"
          role="button"
          tabIndex={0}
          title={`${root.path} · 失联（文件夹不可达）`}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          <AlertCircle size={12} className="arc-root-miss-ic" />
          <span className="ws-truncate arc-root-name">{root.name}</span>
          <span className="arc-root-miss-tag">失联</span>
        </div>
        <div className="arc-root-miss-note">
          <span className="ws-truncate">文件夹不可达（可能被移动、删除，或所在磁盘未连接）</span>
          <span className="arc-root-miss-acts">
            <button className="arc-root-miss-act" onClick={() => relocateRoot(root.id)}>
              重新定位
            </button>
            <button className="arc-root-miss-act" onClick={() => removeRoot(root.id)}>
              移除
            </button>
          </span>
        </div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              { label: '重新定位…', onClick: () => relocateRoot(root.id) },
              { label: '移除', danger: true, onClick: () => removeRoot(root.id) },
            ]}
          />
        )}
      </div>
    )
  }

  const mine = files.filter((f) => f.rootId === root.id)
  const shown = q ? mine.filter((f) => f.path.toLowerCase().includes(q)) : mine
  const rootDirs = q ? [] : dirs.filter((d) => d.rootId === root.id).map((d) => d.path)
  const tree = compactTree(buildFileTree(shown, rootDirs)) // 压缩单子文件夹链（省深层无谓缩进）
  if (q && !shown.length) return null // while filtering, drop roots with no matches
  const drive = root.origin === 'gdrive'
  return (
    <div className="arc-root">
      <div
        className={
          `arc-root-head ${rootDrop ? 'is-drop' : ''}` + (insert ? ` is-insert-${insert}` : '')
        }
        role="button"
        tabIndex={0}
        title={`${root.path} · 拖动可调整文件夹顺序`}
        draggable
        onDragStart={(e) => {
          dragRootId = root.id
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', root.name)
        }}
        onDragEnd={() => {
          dragRootId = null
          clearDrop?.()
          clearDrop = null
        }}
        onClick={() => toggle(key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle(key)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          // 根重排：另一个根的标题拖过来 → 显示上/下沿插入线
          if (dragRootId && dragRootId !== root.id) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            clearDrop = () => setInsert(null)
            setInsert(insertAt(e))
            return
          }
          // 文件挪到根顶层：skip if no file dragged, cross-root, or already at top
          if (!dragFile || dragFile.rootId !== root.id || parentDir(dragFile.path) === '') return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          clearDrop = () => setRootDrop(false)
          setRootDrop(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setRootDrop(false)
            setInsert(null)
          }
        }}
        onDrop={(e) => {
          if (dragRootId && dragRootId !== root.id) {
            e.preventDefault()
            const pos = insert ?? insertAt(e)
            setInsert(null)
            clearDrop = null
            const ids = useStore.getState().roots.map((r) => r.id)
            reorderRoots(dragRootId, targetIndex(ids, dragRootId, root.id, pos))
            dragRootId = null
            return
          }
          if (!dragFile || dragFile.rootId !== root.id) return
          e.preventDefault()
          setRootDrop(false)
          clearDrop = null
          moveFile(dragFile, '')
        }}
      >
        <ChevronRight size={12} className={`arc-caret ${open ? 'is-open' : ''}`} />
        <span className="arc-root-ico">{drive ? <Cloud size={12} /> : <HardDrive size={12} />}</span>
        <span className="ws-truncate arc-root-name">{root.name}</span>
        <span className="arc-root-path ws-truncate">{root.path}</span>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: '新建文档', onClick: () => openCreate({ rootId: root.id, dir: '' }) },
            ...(index > 0
              ? [{ label: '移到最上面', onClick: () => reorderRoots(root.id, 0) }]
              : []),
            { label: '移除（磁盘文件不动）', danger: true, onClick: () => removeRoot(root.id) },
          ]}
        />
      )}
      {open && (
        <div className="arc-root-kids">
          {tree.length ? (
            tree.map((n, i) => (
              <FileBranch key={i} node={n} depth={0} path={n.name} rootId={root.id} forceOpen={!!q} />
            ))
          ) : (
            <div className="arc-lib-empty">{q ? '没有匹配的文件' : '这个文件夹还没有文件'}</div>
          )}
        </div>
      )}
    </div>
  )
}

// The sidebar library: the flat list of opened folders (roots) — each an
// independent tree, draggable to reorder. 没有「工作区 / Space」外壳、没有切换器；
// 云盘（团队/私有）是「之后上云」的内容，当前不在这里。
function Library({ query }: { query: string }) {
  const roots = useStore((s) => s.roots)
  const openAddFolder = useUI((s) => s.openAddFolder)
  const q = query.trim().toLowerCase()

  return (
    <div className="arc-lib">
      {roots.map((r, i) => (
        <RootSection key={r.id} root={r} index={i} query={query} />
      ))}
      {!roots.length && !q && <div className="arc-lib-empty">还没有打开任何文件夹。</div>}
      {!q && (
        <button
          className="arc-add-root"
          onClick={openAddFolder}
          title="再打开一个文件夹，和现有的并排显示"
        >
          <FolderPlus size={13} />
          <span>添加文件夹…</span>
        </button>
      )}
    </div>
  )
}

export default function ArcSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    tabs,
    activeTabId,
    getDoc,
    newBrowserTab,
    openNewTab,
    saveActiveDoc,
  } = { ...useStore(), openNewTab: useUI((s) => s.openNewTab) }
  const me = useStore((s) => s.getMember(s.meId))
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const openFind = useUI((s) => s.openFind)
  const revealFolders = useUI((s) => s.revealFolders)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 侧栏宽度可拖拽（F1，对齐真 app 的 .sb-resize）：右边界拖拽柄改宽度（夹 180–520），
  // 存 localStorage、刷新恢复；收起态不渲染柄。
  const asideRef = useRef<HTMLElement>(null)
  const [sbWidth, setSbWidth] = useState(() => {
    const v = parseInt(localStorage.getItem('ws-arc-width') ?? '', 10)
    return v >= 180 && v <= 520 ? v : 274
  })
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = asideRef.current?.getBoundingClientRect().width ?? sbWidth
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(180, Math.min(520, startW + (ev.clientX - startX)))
      if (asideRef.current) asideRef.current.style.width = `${w}px`
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      const w = Math.round(asideRef.current?.getBoundingClientRect().width ?? sbWidth)
      setSbWidth(w)
      localStorage.setItem('ws-arc-width', String(w))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const doc = activeTab?.docId ? getDoc(activeTab.docId) : undefined
  const isLocal = !doc?.publishedUrl || doc.visibility === 'private' || doc.visibility === 'invited'

  const [omni, setOmni] = useState(activeTab?.url ?? '')
  useEffect(() => {
    setOmni(activeTab?.url ?? '')
  }, [activeTabId, activeTab?.url])

  // file-tree quick filter (the real "search my files", separate from the web omnibox)
  const [query, setQuery] = useState('')

  // 全局壳快捷键（作用域模型的最外层，见 public/shortcuts.html §1/§3.1）。
  // 原则：弹层开着时不穿透（anyOverlayOpen 守卫）；未命中必须放行（不 preventDefault）。
  // 注意：浏览器保留 Cmd+T/Cmd+W/Cmd+1-9（菜单级），这些在网页 demo 里可能被浏览器吞掉，
  // 真 Electron app 里正常；Ctrl+Tab 浏览器不保留，demo 里就能用。
  useEffect(() => {
    // 标签页的「显示顺序」：置顶组在前、普通组在后（与 TabStrip 渲染一致）
    const tabsInOrder = () => {
      const st = useStore.getState()
      return [...st.tabs.filter((t) => t.pinned), ...st.tabs.filter((t) => !t.pinned)]
    }
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState()
      // Ctrl+Tab / Ctrl+Shift+Tab 循环标签页（按条顺序，不做 MRU）——不带 meta
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        if (anyOverlayOpen(ui)) return
        e.preventDefault()
        const seq = tabsInOrder()
        if (seq.length < 2) return
        const st = useStore.getState()
        const idx = seq.findIndex((t) => t.id === st.activeTabId)
        const next = seq[(idx + (e.shiftKey ? -1 : 1) + seq.length) % seq.length]
        st.setActiveTab(next.id)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return // Cmd+Option 组合归编辑器（转块），这里不碰
      // Cmd+/ = 快捷键面板开关（toggle）。放在弹层守卫之前：面板开着时再按一次要能关掉。
      // 注意 toggle 必须收在这一个 handler 里——若面板自己再监听 Cmd+/，trusted 事件会
      // 同步 flush effects，同一个还在冒泡的事件被新挂的监听器再吃一次、开了秒关。
      if (e.key === '/') {
        e.preventDefault()
        if (ui.shortcutsOpen) ui.closeShortcuts()
        else if (!anyOverlayOpen(ui)) ui.openShortcuts()
        return
      }
      // 弹层最优先：modal/面板开着时全局键不执行（Esc/Enter 归弹层自己）
      if (anyOverlayOpen(ui)) return
      if (e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === ',') {
        e.preventDefault()
        navigate('/settings')
      } else if (!e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        openNewTab()
      } else if (e.shiftKey && (e.key === 's' || e.key === 'S')) {
        // 另存为…（裁决 4：Cmd+Shift+S 回归 HIG 语义；删除线已迁 Cmd+Shift+X）
        e.preventDefault()
        const st = useStore.getState()
        const tab = st.tabs.find((t) => t.id === st.activeTabId)
        const doc = tab?.docId ? st.getDoc(tab.docId) : undefined
        if (doc) ui.openSave(doc.id)
      } else if (!e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        saveActiveDoc()
      } else if (!e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        // Cmd+F = 文档内查找（调研裁决：全软件铁律，还给正文）。仅当编辑器有打开的文档时。
        const st = useStore.getState()
        const tab = st.tabs.find((t) => t.id === st.activeTabId)
        if (tab?.docId) {
          e.preventDefault()
          ui.openDocFind()
        }
      } else if (e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        // Cmd+Shift+F = 聚焦文件筛选框（Cmd+F 让位给文档内查找后，文件筛选下沉到这，抄 VS Code 分层）
        e.preventDefault()
        if (useUI.getState().sidebarCollapsed) toggleSidebar()
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('.arc-filter-input')?.focus()
        }, 0)
      } else if (!e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        openFind()
      } else if (!e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        // 关闭当前标签页（置顶标签不关，同浏览器惯例；未保存先弹确认）
        e.preventDefault()
        const st = useStore.getState()
        const tab = st.tabs.find((t) => t.id === st.activeTabId)
        if (!tab || tab.pinned) return
        const doc = tab.docId ? st.getDoc(tab.docId) : undefined
        if (doc?.unsaved) ui.askCloseTab(tab.id)
        else st.closeTab(tab.id)
      } else if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        // 直达第 N 个标签页；9 = 最后一个（浏览器语义）
        e.preventDefault()
        const seq = tabsInOrder()
        if (!seq.length) return
        const target = e.key === '9' ? seq[seq.length - 1] : seq[Number(e.key) - 1]
        if (target) useStore.getState().setActiveTab(target.id)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleSidebar, openNewTab, saveActiveDoc, openFind, navigate])

  // F6：切到某个文件标签页时，在左侧树展开它所在根 + 祖先文件夹并滚动定位（高亮由 is-active 负责）。
  useEffect(() => {
    const path = activeTab?.fileName ? activeTab.url : ''
    const rootId = activeTab?.rootId
    if (!path || !rootId) return
    const parts = path.split('/').filter(Boolean)
    const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
    revealFolders(rootId, dirs)
    const id = window.setTimeout(() => {
      scrollRef.current?.querySelector('.arc-file.is-active')?.scrollIntoView({ block: 'nearest' })
    }, 40)
    return () => window.clearTimeout(id)
  }, [activeTabId, activeTab?.url, activeTab?.fileName, activeTab?.rootId, revealFolders])

  // sticky ancestor：滚动时给「当前正吸顶」的祖先文件夹标 is-stuck，最深那条标 is-stuck-last（加吸顶阴影）。
  // 纯视觉区分——CSS 认不出「已吸顶」，靠这个轻量 scroll 监听（直接 toggle class，不触发 React 重渲）。
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    let raf = 0
    const paint = () => {
      raf = 0
      const scTop = sc.getBoundingClientRect().top
      const padTop = parseFloat(getComputedStyle(sc).paddingTop) || 0
      const heads = sc.querySelectorAll<HTMLElement>('.arc-folder-head')
      let last: HTMLElement | null = null
      heads.forEach((h) => {
        const pinnedY = scTop + padTop + (parseFloat(getComputedStyle(h).top) || 0)
        const stuck = h.getBoundingClientRect().top <= pinnedY + 0.5
        h.classList.toggle('is-stuck', stuck)
        if (stuck) last = h
      })
      heads.forEach((h) => h.classList.toggle('is-stuck-last', h === last))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(paint)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    paint()
    return () => {
      sc.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  })

  const submitOmni = () => {
    const v = omni.trim()
    if (!v) return
    if (activeTab?.kind !== 'web') newBrowserTab()
    useBrowser.getState().navigate(v)
    navigate('/docs')
  }
  const goBack = () => {
    useBrowser.getState().back()
    navigate('/docs')
  }
  const goForward = () => {
    useBrowser.getState().forward()
    navigate('/docs')
  }
  const onNewTab = () => {
    // 打开「新建」modal（顶部地址栏 + 下面新建文档）；网页标签页在地址栏回车时才真正创建
    openNewTab()
  }
  const reload = () => {
    if (activeTab?.kind === 'web' && activeTab.url) useBrowser.getState().navigate(activeTab.url)
    navigate('/docs')
  }

  const util = [
    { to: '/settings', icon: Settings2, label: '设置' },
  ]

  if (collapsed) {
    return (
      <aside className="arc-sidebar is-collapsed">
        <div className="arc-top arc-top-collapsed">
          <button className="arc-ico" title="展开侧栏" onClick={toggleSidebar}>
            <PanelLeft size={15} />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="arc-sidebar" ref={asideRef} style={{ width: `${sbWidth}px` }}>
      <div className="arc-resize" onMouseDown={startResize} title="拖拽调整侧栏宽度" />
      <div className="arc-top">
        <div className="arc-traffic">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>
        <div className="arc-top-nav">
          <button className="arc-ico" title="收起侧栏" onClick={toggleSidebar}><PanelLeft size={15} /></button>
          <button className="arc-ico" title="后退" onClick={goBack}><ChevronLeft size={16} /></button>
          <button className="arc-ico" title="前进" onClick={goForward}><ChevronRight size={16} /></button>
          <button className="arc-ico" title="刷新" onClick={reload}><RotateCw size={13} /></button>
          <button className="arc-ico" title={IS_MAC ? '查找文件 ⌘P' : '查找文件 Ctrl+P'} onClick={openFind}><Search size={14} /></button>
        </div>
      </div>

      <div className="arc-omni">
        {doc?.visibility === 'public' ? (
          <Globe size={13} className="addr-public" />
        ) : doc?.visibility === 'internal' ? (
          <Lock size={13} className="addr-internal" />
        ) : activeTab?.kind === 'web' ? (
          <Globe size={13} />
        ) : (
          <FolderClosed size={13} />
        )}
        <input
          className="arc-omni-url arc-omni-input"
          value={omni}
          onChange={(e) => setOmni(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitOmni()
          }}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="搜索,或输入网址"
          spellCheck={false}
        />
        {isLocal && activeTab?.kind !== 'web' && <span className="arc-omni-tag">本地</span>}
      </div>

      <div className="arc-scroll" ref={scrollRef}>
        <div className="arc-section-label">置顶</div>
        <TabStrip pinned emptyHint="把标签页拖到这里置顶" />

        <div className="arc-section-label arc-tabs-label">
          <span>标签页</span>
          <button className="arc-ico arc-ico-sm" title="新建标签页" onClick={onNewTab}>
            <Plus size={14} />
          </button>
        </div>
        <TabStrip pinned={false} />

        <div className="arc-section-label">文档</div>
        <div className="arc-filter">
          <Search size={13} className="arc-filter-ico" />
          <input
            className="arc-filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选文件"
            spellCheck={false}
          />
          {query && (
            <button className="arc-filter-clear" title="清除" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <Library query={query} />
      </div>

      <div className="arc-foot">
        <div className="arc-util">
          {/* AI 接入：浮动 modal（不再是整页路由） */}
          <button
            className="arc-util-btn"
            title="AI 接入"
            onClick={() => useUI.getState().openAgents()}
          >
            <Bot size={16} />
          </button>
          {util.map(({ to, icon: Icon, label }) => (
            <button
              key={to}
              className={`arc-util-btn ${location.pathname === to ? 'is-active' : ''}`}
              title={label}
              onClick={() => navigate(to)}
            >
              <Icon size={16} />
            </button>
          ))}
          {/* 快捷键速查（⌘/ 或 Ctrl+/）+ 完整键位文档入口（Wendi review 用） */}
          <button
            className="arc-util-btn"
            title={IS_MAC ? '快捷键 ⌘/' : '快捷键 Ctrl+/'}
            onClick={() => useUI.getState().openShortcuts()}
          >
            <Keyboard size={16} />
          </button>
          <div className="arc-util-spacer" />
          {me && (
            <button className="arc-util-me" title={`${me.name} · 账户设置`} onClick={() => navigate('/settings')}>
              <Avatar member={me} size={24} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
