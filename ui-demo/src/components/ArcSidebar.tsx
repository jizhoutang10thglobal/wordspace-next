import { useRef, useState, useEffect, useMemo } from 'react'
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
  Star,
  Bookmark,
  History as HistoryIcon,
  LayoutTemplate,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI, anyOverlayOpen } from '../mock/ui'
import { useBrowser } from '../mock/browser'
import { useBookmarks, BM_BAR } from '../mock/bookmarks'
import { useHistory } from '../mock/history'
import { useNav } from '../mock/nav'
import { useT } from '../i18n'
import { Avatar } from '../ui/primitives'
import { buildFileTree, compactTree, type FileNode } from '../lib/tree'
import { computeBacklinks, computeDirBacklinks } from '../lib/links'
import { IS_MAC } from '../lib/platform'
import { coachOnce } from '../mock/coach'
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
// 互链入口③：把侧栏文件拖进编辑器正文 = 在落点插入指向它的链接（Canvas 消费）。
export const getDragFile = (): FileEntry | null => dragFile
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
  const t = useT()
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
      {unsaved && <span className="arc-tab-dot" title={t('sidebar.unsavedTabHint')} />}
      <button
        className="arc-tab-act"
        title={pinned ? t('sidebar.unpin') : t('sidebar.pin')}
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
          title={t('sidebar.closeTabHint', { key: IS_MAC ? '⌘W' : 'Ctrl+W' })}
          onClick={(e) => {
            e.stopPropagation()
            // 未保存的临时文档 → 弹确认；否则直接关。切换标签页不走这里（不提示）。
            if (unsaved) askCloseTab(tab.id)
            else closeTab(tab.id)
            coachOnce(useStore.getState().toast, 'close-tab', t('sidebar.coachCloseTab', { key: IS_MAC ? '⌘W' : 'Ctrl+W' }))
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// 收藏项的首字彩块图标（无真 favicon 时用标题首字 hash 到稳定色，比灰地球好认）。
function FavChip({ label, seed }: { label: string; seed: string }) {
  const ch = label.trim().charAt(0).toUpperCase() || '·'
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span className="arc-fav-chip" style={{ background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 42% 40%)` }}>
      {ch}
    </span>
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
  const t = useT()
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
            // 'all' 不是 'move'：文件既可拖进文件夹（move）也可拖进正文变链接（link）。
            // effectAllowed 与落点 dropEffect 不兼容时浏览器会**直接禁掉 drop**（事件都不发）——
            // 之前声明 move、画布落点要 link，真实拖拽全灭（合成事件测试测不出这层，Colin 实测抓到）。
            e.dataTransfer.effectAllowed = 'all'
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
              { label: t('common.open'), onClick: openIt },
              { label: t('common.rename'), onClick: () => setRenaming(true) },
              {
                label: t('common.delete'),
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
          title={t('sidebar.newDocHere')}
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
            { label: t('sidebar.newDoc'), onClick: newDocHere },
            { label: t('sidebar.newSubfolder'), onClick: () => createSubfolder(rootId, path) },
            { label: t('common.rename'), onClick: () => setRenaming(true) },
            {
              label: t('common.delete'),
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
            {t('sidebar.emptyFolder')}
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
  const t = useT()
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
          title={t('sidebar.rootMissingTitle', { path: root.path })}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          <AlertCircle size={12} className="arc-root-miss-ic" />
          <span className="ws-truncate arc-root-name">{root.name}</span>
          <span className="arc-root-miss-tag">{t('sidebar.missingTag')}</span>
        </div>
        <div className="arc-root-miss-note">
          <span className="ws-truncate">{t('sidebar.missingNote')}</span>
          <span className="arc-root-miss-acts">
            <button className="arc-root-miss-act" onClick={() => relocateRoot(root.id)}>
              {t('sidebar.relocate')}
            </button>
            <button className="arc-root-miss-act" onClick={() => removeRoot(root.id)}>
              {t('sidebar.remove')}
            </button>
          </span>
        </div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              { label: t('sidebar.relocateEllipsis'), onClick: () => relocateRoot(root.id) },
              { label: t('sidebar.remove'), danger: true, onClick: () => removeRoot(root.id) },
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
        title={t('sidebar.rootDragTitle', { path: root.path })}
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
            { label: t('sidebar.newDoc'), onClick: () => openCreate({ rootId: root.id, dir: '' }) },
            ...(index > 0
              ? [{ label: t('sidebar.moveToTop'), onClick: () => reorderRoots(root.id, 0) }]
              : []),
            { label: t('sidebar.removeKeepDisk'), danger: true, onClick: () => removeRoot(root.id) },
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
            <div className="arc-lib-empty">{q ? t('sidebar.noMatchFiles') : t('sidebar.rootEmpty')}</div>
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
  const t = useT()
  const roots = useStore((s) => s.roots)
  const openAddFolder = useUI((s) => s.openAddFolder)
  const q = query.trim().toLowerCase()

  return (
    <div className="arc-lib">
      {roots.map((r, i) => (
        <RootSection key={r.id} root={r} index={i} query={query} />
      ))}
      {!roots.length && !q && <div className="arc-lib-empty">{t('sidebar.noFolders')}</div>}
      {!q && (
        <button
          className="arc-add-root"
          onClick={openAddFolder}
          title={t('sidebar.addRootTitle')}
        >
          <FolderPlus size={13} />
          <span>{t('sidebar.addFolderEllipsis')}</span>
        </button>
      )}
    </div>
  )
}

export default function ArcSidebar() {
  const t = useT()
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

  // 侧栏宽度可拖拽（F1，对齐真 app 的 .sb-resize）：右边界拖拽柄改宽度（夹 240–520），
  // 存 localStorage、刷新恢复；收起态不渲染柄。
  // 最小 240（Wendi 2026-07-16）：顶排图标行 240 下刚好放得下，再窄图标被裁掉消失；
  // 想更窄该走「收起侧栏」。旧存值 <240 夹到 240（别跳回默认宽，贴用户原意）。
  const asideRef = useRef<HTMLElement>(null)
  const [sbWidth, setSbWidth] = useState(() => {
    const v = parseInt(localStorage.getItem('ws-arc-width') ?? '', 10)
    return Number.isFinite(v) ? Math.max(240, Math.min(520, v)) : 274
  })

  // 收起态 = 沉浸模式（Wendi 对标 Arc，2026-07-16）：不留 48px 细轨，内容四边贴满。
  // 重开三入口：左缘 hover 滑出悬浮侧栏（peek，盖在内容上不推挤）、Cmd+\、peek 里点收起钮真展开。
  // peek 做在同一个组件实例里（不另挂 <ArcSidebar overlay/>）——全局快捷键监听在本组件的
  // effect 上，双实例会双挂监听、Cmd+\ 一次触发两回（开了秒关，见上面 handler 的注释）。
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<number | undefined>(undefined)
  const peekEnter = () => {
    window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => setPeek(true), 120)
  }
  const peekLeave = () => {
    window.clearTimeout(peekTimer.current)
    peekTimer.current = window.setTimeout(() => setPeek(false), 240)
  }
  useEffect(() => {
    // 展开/再收起时清残留 peek 态与计时器，避免下次收起瞬间弹出旧 peek
    setPeek(false)
    window.clearTimeout(peekTimer.current)
  }, [collapsed])
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = asideRef.current?.getBoundingClientRect().width ?? sbWidth
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(240, Math.min(520, startW + (ev.clientX - startX)))
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

  // 后退/前进按钮响应式启用态：无历史可退时置灰（否则「能点但没反应」= 手感坏）。
  // 网页标签走浏览器历史；文档/文件标签走文档导航历史 useNav（文档互链上线后「点错能回上一篇」）。
  const browserHistory = useBrowser((s) => s.history)
  const curHist = activeTab?.kind === 'web' ? browserHistory[activeTabId] : undefined
  const navCanBack = useNav((s) => s.past.length > 0)
  const navCanForward = useNav((s) => s.future.length > 0)
  const canBack = activeTab?.kind === 'web' ? !!curHist && curHist.index > 0 : navCanBack
  const canFwd = activeTab?.kind === 'web' ? !!curHist && curHist.index < curHist.stack.length - 1 : navCanForward

  // 收藏夹：网页标签才显示星标；点击/⌘D 加入或移出收藏。
  const bmList = useBookmarks((s) => s.bookmarks)
  const bmFolders = useBookmarks((s) => s.folders)
  // 侧栏收藏区：默认收起，点标题行展开；展开/收起记住上次（拍板 2026-07-10）。
  const [favOpen, setFavOpen] = useState(() => localStorage.getItem('ws-fav-open') === '1')
  const toggleFav = () =>
    setFavOpen((v) => {
      localStorage.setItem('ws-fav-open', v ? '0' : '1')
      return !v
    })
  // 置顶/标签页折叠（Colin 2026-07-15：三栏折叠统一）。默认展开——与收藏默认收起相反（主导航别一装就藏）。
  const [pinnedOpen, setPinnedOpen] = useState(() => localStorage.getItem('ws-pinned-open') !== '0')
  const [tabsOpen, setTabsOpen] = useState(() => localStorage.getItem('ws-tabs-open') !== '0')
  const zoneTabs = useStore((s) => s.tabs)
  const pinnedCount = zoneTabs.filter((t) => t.pinned).length
  const tabsCount = zoneTabs.length - pinnedCount
  const toggleZone = (key: string, set: (fn: (v: boolean) => boolean) => void) =>
    set((v) => {
      localStorage.setItem(key, v ? '0' : '1')
      return !v
    })
  const isWebTab = activeTab?.kind === 'web' && !!activeTab.url && activeTab.url !== 'wordspace://newtab'
  const bookmarked = !!isWebTab && bmList.some((b) => b.url === activeTab!.url)
  const toggleBookmark = () => {
    if (!isWebTab || !activeTab) return
    const bm = useBookmarks.getState()
    if (bm.isBookmarked(activeTab.url)) { bm.removeByUrl(activeTab.url); useStore.getState().toast(t('sidebar.bookmarkRemoved')) }
    else { bm.add({ title: activeTab.title || activeTab.url, url: activeTab.url }); useStore.getState().toast(t('sidebar.bookmarkAdded'), 'success') }
  }
  // 侧栏收藏区点书签：已开着该网址的网页标签就聚焦过去（含置顶），否则新标签打开 + 记历史
  //（Colin 2026-07-10 拍板：聚焦已开，别连点连开重复标签）。
  const openBookmark = (url: string, title: string) => {
    const st = useStore.getState()
    const existing = st.tabs.find((t) => t.kind === 'web' && t.url === url)
    if (existing) st.setActiveTab(existing.id)
    else {
      st.openWebTab(url, title)
      useHistory.getState().record(url, title)
    }
    navigate('/docs')
  }
  const [omni, setOmni] = useState(activeTab?.url ?? '')
  useEffect(() => {
    setOmni(activeTab?.url ?? '')
  }, [activeTabId, activeTab?.url])

  // 地址栏自动补全：边打字从「开着的标签 / 收藏 / 历史」给建议（按此优先级去重）。
  const [omniOpen, setOmniOpen] = useState(false)
  const [omniSel, setOmniSel] = useState(-1)
  const omniSug = useMemo(() => {
    const t = omni.trim().toLowerCase()
    if (!t || !omniOpen) return []
    if (activeTab?.kind === 'web' && omni === activeTab.url) return [] // 没在打字(显示的是当前 url) → 不弹
    const out: { url: string; title: string; kind: 'tab' | 'bookmark' | 'history' }[] = []
    const seen = new Set<string>()
    const add = (url: string, title: string, kind: 'tab' | 'bookmark' | 'history') => {
      if (!url || url === 'wordspace://newtab' || seen.has(url)) return
      seen.add(url); out.push({ url, title: title || url, kind })
    }
    for (const tb of tabs) if (tb.kind === 'web' && tb.url && (tb.url.toLowerCase().includes(t) || (tb.title || '').toLowerCase().includes(t))) add(tb.url, tb.title, 'tab')
    for (const bk of bmList) if (bk.url.toLowerCase().includes(t) || bk.title.toLowerCase().includes(t)) add(bk.url, bk.title, 'bookmark')
    for (const h of useHistory.getState().search(omni, 8)) add(h.url, h.title, 'history')
    return out.slice(0, 6)
  }, [omni, omniOpen, tabs, bmList, activeTab?.kind, activeTab?.url])

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
      } else if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
        // Cmd+Shift+T 重开刚关闭的标签
        e.preventDefault()
        const st = useStore.getState()
        if (st.closedTabs.length) { st.reopenClosedTab(); navigate('/docs') }
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
        // Cmd+F = 页内查找。文档 → 编辑器查找条；网页标签 → 网页查找条（覆盖真 app 的两半）。
        const st = useStore.getState()
        const tab = st.tabs.find((t) => t.id === st.activeTabId)
        if (tab?.docId) {
          e.preventDefault()
          ui.openDocFind()
        } else if (tab?.kind === 'web') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('ws-web-find'))
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
      } else if (!e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        // Cmd+D 收藏 / 取消收藏当前网页
        const st = useStore.getState()
        const tab = st.tabs.find((t) => t.id === st.activeTabId)
        if (!tab || tab.kind !== 'web' || !tab.url || tab.url === 'wordspace://newtab') return
        e.preventDefault()
        const b = useBookmarks.getState()
        if (b.isBookmarked(tab.url)) { b.removeByUrl(tab.url); st.toast(t('sidebar.bookmarkRemoved')) }
        else { b.add({ title: tab.title || tab.url, url: tab.url }); st.toast(t('sidebar.bookmarkAdded'), 'success') }
      } else if (!e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        // Cmd+L 聚焦地址栏
        e.preventDefault()
        if (useUI.getState().sidebarCollapsed) toggleSidebar()
        window.setTimeout(() => {
          const el = document.querySelector<HTMLInputElement>('.arc-omni-input')
          el?.focus(); el?.select()
        }, 0)
      } else if (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0') {
        // Cmd +/-/0 网页缩放（仅网页标签，读实时激活态防闭包过期）
        const st = useStore.getState()
        const at = st.tabs.find((t) => t.id === st.activeTabId)
        if (at?.kind !== 'web') return
        e.preventDefault()
        if (e.key === '0') useBrowser.getState().zoomReset()
        else useBrowser.getState().zoomBy(e.key === '-' ? -0.1 : 0.1)
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
  }, [toggleSidebar, openNewTab, saveActiveDoc, openFind, navigate, t])

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

  const submitOmni = (explicitUrl?: string) => {
    const v = (explicitUrl ?? omni).trim()
    if (!v) return
    setOmniOpen(false); setOmniSel(-1)
    if (activeTab?.kind !== 'web') newBrowserTab()
    useBrowser.getState().navigate(v)
    navigate('/docs')
  }
  const goBack = () => {
    if (activeTab?.kind === 'web') useBrowser.getState().back()
    else useNav.getState().back()
    navigate('/docs')
  }
  const goForward = () => {
    if (activeTab?.kind === 'web') useBrowser.getState().forward()
    else useNav.getState().forward()
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
  // 教学气泡：鼠标点了有快捷键的操作 → 弹一次「下次可以按 ⌘X」（每操作只一次，localStorage 记住）。
  // 只在鼠标 onClick 里调；键盘快捷键触发不调（用户已经会了）。
  const coach = (op: string, message: string) => coachOnce(useStore.getState().toast, op, message)

  const util = [
    { to: '/templates', icon: LayoutTemplate, label: t('sidebar.templates') },
    { to: '/settings', icon: Settings2, label: t('sidebar.settings') },
  ]

  // 完整侧栏本体——停靠态与收起态的 peek 悬浮层共用同一份 JSX（单实例，见 peek 注释）
  const body = (
    <aside className="arc-sidebar" ref={asideRef} style={{ width: `${sbWidth}px` }}>
      <div className="arc-resize" onMouseDown={startResize} title={t('sidebar.resizeHint')} />
      <div className="arc-top">
        <div className="arc-traffic">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>
        <div className="arc-top-nav">
          <button
            className="arc-ico"
            title={t('sidebar.collapseSidebarHint', { key: IS_MAC ? '⌘\\' : 'Ctrl+\\' })}
            onClick={() => { toggleSidebar(); coach('toggle-sidebar', t('sidebar.coachToggleSidebar', { key: IS_MAC ? '⌘\\' : 'Ctrl+\\' })) }}
          ><PanelLeft size={15} /></button>
          <button className="arc-ico" title={t('sidebar.navBack')} onClick={goBack} disabled={!canBack}><ChevronLeft size={16} /></button>
          <button className="arc-ico" title={t('sidebar.navForward')} onClick={goForward} disabled={!canFwd}><ChevronRight size={16} /></button>
          <button
            className="arc-ico"
            title={t('sidebar.reloadHint', { key: IS_MAC ? '⌘R' : 'Ctrl+R' })}
            onClick={() => { reload(); coach('reload', t('sidebar.coachReload', { key: IS_MAC ? '⌘R' : 'Ctrl+R' })) }}
          ><RotateCw size={13} /></button>
          <button className="arc-ico" title={t('sidebar.history')} onClick={() => navigate('/history')}><HistoryIcon size={15} /></button>
          <button className="arc-ico" title={t('sidebar.findFileHint', { key: IS_MAC ? '⌘P' : 'Ctrl+P' })} onClick={openFind}><Search size={14} /></button>
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
          onChange={(e) => { setOmni(e.target.value); setOmniOpen(true); setOmniSel(-1) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { const pick = omniSel >= 0 ? omniSug[omniSel] : null; submitOmni(pick?.url); e.currentTarget.blur() }
            else if (e.key === 'ArrowDown') { e.preventDefault(); if (omniSug.length) { setOmniOpen(true); setOmniSel((i) => Math.min(i + 1, omniSug.length - 1)) } }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setOmniSel((i) => Math.max(i - 1, -1)) }
            else if (e.key === 'Escape') { setOmniOpen(false); setOmniSel(-1); e.currentTarget.blur() }
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => window.setTimeout(() => setOmniOpen(false), 150)}
          placeholder={t('sidebar.searchOrUrl')}
          spellCheck={false}
        />
        {isWebTab && (
          <button
            className={`arc-omni-star ${bookmarked ? 'is-on' : ''}`}
            title={bookmarked ? t('sidebar.bookmarkedTitle') : t('sidebar.addBookmarkTitle')}
            onClick={toggleBookmark}
          >
            <Star size={14} fill={bookmarked ? 'currentColor' : 'none'} />
          </button>
        )}
        {isLocal && activeTab?.kind !== 'web' && <span className="arc-omni-tag">{t('sidebar.localTag')}</span>}
        {omniOpen && omniSug.length > 0 && (
          <div className="arc-omni-sug">
            {omniSug.map((s, i) => (
              <button
                key={s.url}
                className={`arc-omni-sug-item ${i === omniSel ? 'is-sel' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); submitOmni(s.url) }}
                onMouseEnter={() => setOmniSel(i)}
              >
                {s.kind === 'bookmark' ? <Star size={12} className="arc-sug-ico" /> : s.kind === 'history' ? <HistoryIcon size={12} className="arc-sug-ico" /> : <Globe2 size={12} className="arc-sug-ico" />}
                <span className="arc-sug-title">{s.title}</span>
                <span className="arc-sug-url">{s.url.replace(/^https?:\/\//, '').replace(/^glass:\/\//, '')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="arc-scroll" ref={scrollRef}>
        {/* 收藏（默认收起，点标题行展开）——放在置顶上方，同 Arc 的 Favorites 在最顶 */}
        <div className={`arc-fav ${favOpen ? 'is-open' : ''}`}>
          <div className="arc-fav-head" onClick={toggleFav}>
            <span className="arc-fav-title">{t('sidebar.favorites')}</span>
            {bmList.length > 0 && <span className="arc-fav-count">{bmList.length}</span>}
            <span className="arc-fav-spacer" />
            <button
              className="arc-ico arc-ico-sm"
              title={t('sidebar.manageBookmarks')}
              onClick={(e) => { e.stopPropagation(); navigate('/bookmarks') }}
            >
              <Bookmark size={13} />
            </button>
            <ChevronRight size={12} className={`arc-caret ${favOpen ? 'is-open' : ''}`} />
          </div>
          {favOpen && (
            <div className="arc-fav-body">
              {bmFolders.map((f) => {
                const items = bmList.filter((b) => b.folderId === f.id)
                if (!items.length) return null
                return (
                  <div key={f.id} className="arc-fav-folder">
                    {f.id !== BM_BAR && <div className="arc-fav-folder-name">{f.name}</div>}
                    {items.map((b) => (
                      <button key={b.id} className="arc-fav-item" title={b.url} onClick={() => openBookmark(b.url, b.title)}>
                        <FavChip label={b.title || b.url} seed={b.url} />
                        <span className="arc-fav-item-title">{b.title}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
              {!bmList.length && <div className="arc-fav-empty">{t('sidebar.favEmptyHint')}</div>}
            </div>
          )}
        </div>

        <div className={`arc-section-label arc-zone-head ${pinnedOpen ? 'is-open' : ''}`} role="button" onClick={() => toggleZone('ws-pinned-open', setPinnedOpen)}>
          <span>{t('sidebar.pinnedSection')}</span>
          <span className="arc-zone-count">{pinnedCount || ''}</span>
          <ChevronRight size={12} className={`arc-caret ${pinnedOpen ? 'is-open' : ''}`} />
        </div>
        {pinnedOpen && <TabStrip pinned emptyHint={t('sidebar.dragToPinHint')} />}

        <div className={`arc-section-label arc-tabs-label arc-zone-head ${tabsOpen ? 'is-open' : ''}`} role="button" onClick={() => toggleZone('ws-tabs-open', setTabsOpen)}>
          <span>{t('sidebar.tabs')}</span>
          <span className="arc-zone-count">{tabsCount || ''}</span>
          <button
            className="arc-ico arc-ico-sm"
            title={t('sidebar.newTabHint', { key: IS_MAC ? '⌘T' : 'Ctrl+T' })}
            onClick={(e) => { e.stopPropagation(); onNewTab(); coach('new-tab', t('sidebar.coachNewTab', { key: IS_MAC ? '⌘T' : 'Ctrl+T' })) }}
          >
            <Plus size={14} />
          </button>
          <ChevronRight size={12} className={`arc-caret ${tabsOpen ? 'is-open' : ''}`} />
        </div>
        {tabsOpen && <TabStrip pinned={false} />}

        <div className="arc-section-label">{t('sidebar.documents')}</div>
        <div className="arc-filter">
          <Search size={13} className="arc-filter-ico" />
          <input
            className="arc-filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sidebar.filterFiles')}
            spellCheck={false}
          />
          {query && (
            <button className="arc-filter-clear" title={t('sidebar.clear')} onClick={() => setQuery('')}>
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
            title={t('sidebar.aiAccess')}
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
            title={t('sidebar.shortcutsHint', { key: IS_MAC ? '⌘/' : 'Ctrl+/' })}
            onClick={() => useUI.getState().openShortcuts()}
          >
            <Keyboard size={16} />
          </button>
          <div className="arc-util-spacer" />
          {me && (
            <button className="arc-util-me" title={t('sidebar.accountSettings', { name: me.name })} onClick={() => navigate('/settings')}>
              <Avatar member={me} size={24} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )

  if (collapsed) {
    // 沉浸收起：流内什么都不渲染（内容贴满），只留 6px 左缘热区 + 悬浮 peek 容器
    return (
      <>
        <div className="arc-edge-hot" onMouseEnter={peekEnter} onMouseLeave={peekLeave} />
        <div
          className={'arc-peek' + (peek ? ' is-on' : '')}
          aria-hidden={!peek}
          onMouseEnter={peekEnter}
          onMouseLeave={peekLeave}
        >
          {body}
        </div>
      </>
    )
  }

  return body
}
