import { useRef, useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RotateCw,
  Lock,
  Globe,
  FolderClosed,
  FileText,
  Plus,
  X,
  Check,
  LayoutTemplate,
  Bot,
  Settings2,
  Shapes,
  Globe2,
  Cloud,
  HardDrive,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File,
  FolderPlus,
  Pin,
  PinOff,
  Search,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useBrowser } from '../mock/browser'
import { Avatar } from '../ui/primitives'
import { buildFileTree, type FileNode } from '../lib/tree'
import { isCloudStorage } from '../types'
import type { Doc, FileEntry, FileKind, Folder, MountRoot, Space, Tab } from '../types'
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

// One strip for a (space, pinned?) group of tabs. It is a drop zone: dropping a
// tab here sets its pinned state and positions it where the insertion line was.
function TabStrip({
  spaceId,
  pinned,
  emptyHint,
}: {
  spaceId: string
  pinned: boolean
  emptyHint?: string
}) {
  const allTabs = useStore((s) => s.tabs)
  const dropTab = useStore((s) => s.dropTab)
  const tabs = allTabs.filter((t) => t.spaceId === spaceId && !!t.pinned === pinned)
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

function DocRow({ doc }: { doc: Doc }) {
  const navigate = useNavigate()
  const { openDoc, tabs, activeTabId } = useStore()
  const activeDocId = tabs.find((t) => t.id === activeTabId)?.docId
  return (
    <button
      className={`arc-doc ${doc.id === activeDocId ? 'is-active' : ''}`}
      onClick={() => {
        openDoc(doc.id)
        navigate('/docs')
      }}
    >
      <FileText size={13} className="arc-doc-ico" />
      <span className="arc-doc-title ws-truncate">{doc.title}</span>
    </button>
  )
}

function FolderGroup({ folder, query }: { folder: Folder; query: string }) {
  const docs = useStore((s) =>
    s.docs
      .filter((d) => d.folderId === folder.id && !d.unsaved)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  )
  const q = query.trim().toLowerCase()
  const shown = q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs
  const key = 'folder:' + folder.id
  const openState = useUI((s) => !s.collapsedKeys[key])
  const open = q ? true : openState // while filtering, keep matches in view
  const toggle = useUI((s) => s.toggleCollapsed)
  // while filtering, drop folders with no matches; otherwise an empty folder
  // stays visible (you can still see and navigate into it — unlike before).
  if (q && !shown.length) return null
  return (
    <div className="arc-folder">
      <button className="arc-folder-head" onClick={() => toggle(key)}>
        <ChevronRight size={12} className={`arc-caret ${open ? 'is-open' : ''}`} />
        <FolderClosed size={13} />
        <span className="ws-truncate">{folder.name}</span>
      </button>
      {open &&
        (shown.length ? (
          shown.map((d) => <DocRow key={d.id} doc={d} />)
        ) : (
          <div className="arc-tree-empty" style={{ paddingLeft: 26 }}>
            空文件夹
          </div>
        ))}
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
  spaceId,
  rootId,
  forceOpen,
}: {
  node: FileNode
  depth: number
  path: string
  spaceId: string
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
        <div className="arc-file" style={{ paddingLeft: 26 + depth * 16 }}>
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
          style={{ paddingLeft: 26 + depth * 16 }}
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
              { label: '删除', danger: true, onClick: () => deleteFileWithUndo(f) },
            ]}
          />
        )}
      </>
    )
  }

  // ---------- directory ----------
  if (renaming) {
    return (
      <div className="arc-file" style={{ paddingLeft: 8 + depth * 16 }}>
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
        style={{ paddingLeft: 8 + depth * 16 }}
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
          // skip if no file dragged, cross-space/cross-root, or already in this folder
          if (
            !dragFile ||
            dragFile.spaceId !== spaceId ||
            dragFile.rootId !== rootId ||
            parentDir(dragFile.path) === path
          )
            return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          clearDrop = () => setDropOver(false)
          setDropOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false)
        }}
        onDrop={(e) => {
          if (!dragFile || dragFile.spaceId !== spaceId || dragFile.rootId !== rootId) return
          e.preventDefault()
          e.stopPropagation()
          setDropOver(false)
          clearDrop = null
          moveFile(dragFile, path)
        }}
      >
        <ChevronRight size={12} className={`arc-caret ${open ? 'is-open' : ''}`} />
        <FolderClosed size={13} />
        <span className="ws-truncate arc-folder-name">{node.name}</span>
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
            { label: '删除', danger: true, onClick: () => deleteDirWithUndo(rootId, path) },
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
              spaceId={spaceId}
              rootId={rootId}
              forceOpen={forceOpen}
            />
          ))
        ) : (
          <div className="arc-tree-empty" style={{ paddingLeft: 26 + (depth + 1) * 16 }}>
            空文件夹
          </div>
        ))}
    </div>
  )
}

// The colored identity square for a space (its initial on its accent color).
function SpaceIcon({ space }: { space: Space }) {
  return (
    <span className="arc-space-ic" style={{ background: space.color }} aria-hidden>
      {space.badge}
    </span>
  )
}

// A space's one-line detail under its name. Category is already carried by the
// group header, so this shows the useful bit: capability for cloud, the folder
// path (or folder count) for a connected space.
function spaceDetail(space: Space): string {
  if (isCloudStorage(space.storage)) return '实时协作、Agent'
  const roots = space.roots ?? []
  if (roots.length > 1) return `${roots.length} 个文件夹`
  return roots[0]?.path ?? space.subtitle
}

// One mount root's section in the library: a collapsible root header (folder
// name; hover shows the full path; right-click to manage) + its own file tree,
// indented inside a rail so「根包含下面这些」的层级一眼可读。
// The header is (a) the "drop file here to move to this root's top level"
// target and (b) draggable itself, to reorder roots（顺序随 spaces 持久化）。
function RootSection({
  space,
  root,
  index,
  query,
  removable,
}: {
  space: Space
  root: MountRoot
  index: number
  query: string
  removable: boolean
}) {
  const files = useStore((s) => s.files)
  const dirs = useStore((s) => s.dirs)
  const moveFile = useStore((s) => s.moveFile)
  const removeRootFromSpace = useStore((s) => s.removeRootFromSpace)
  const reorderRoots = useStore((s) => s.reorderRoots)
  const openCreate = useUI((s) => s.openCreate)
  const key = 'root:' + root.id
  const openState = useUI((s) => !s.collapsedKeys[key])
  const toggle = useUI((s) => s.toggleCollapsed)
  const q = query.trim().toLowerCase()
  const open = q ? true : openState
  const [rootDrop, setRootDrop] = useState(false)
  const [insert, setInsert] = useState<InsertPos | null>(null) // 根重排的插入线位置
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const mine = files.filter((f) => f.spaceId === space.id && f.rootId === root.id)
  const shown = q ? mine.filter((f) => f.path.toLowerCase().includes(q)) : mine
  const rootDirs = q
    ? []
    : dirs.filter((d) => d.spaceId === space.id && d.rootId === root.id).map((d) => d.path)
  const tree = buildFileTree(shown, rootDirs)
  if (q && !shown.length) return null // while filtering, drop roots with no matches
  const drive = space.storage === 'gdrive'
  return (
    <div className="arc-root">
      <div
        className={
          `arc-root-head ${rootDrop ? 'is-drop' : ''}` +
          (insert ? ` is-insert-${insert}` : '')
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
          // 文件挪到根顶层：skip if no file dragged, cross-space/cross-root, or already at top
          if (
            !dragFile ||
            dragFile.spaceId !== space.id ||
            dragFile.rootId !== root.id ||
            parentDir(dragFile.path) === ''
          )
            return
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
            const ids = (space.roots ?? []).map((r) => r.id)
            reorderRoots(space.id, dragRootId, targetIndex(ids, dragRootId, root.id, pos))
            dragRootId = null
            return
          }
          if (!dragFile || dragFile.spaceId !== space.id || dragFile.rootId !== root.id) return
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
              ? [{ label: '移到最上面', onClick: () => reorderRoots(space.id, root.id, 0) }]
              : []),
            ...(removable
              ? [
                  {
                    label: '从工作区移除（磁盘文件不动）',
                    danger: true,
                    onClick: () => removeRootFromSpace(space.id, root.id),
                  },
                ]
              : []),
          ]}
        />
      )}
      {open && (
        <div className="arc-root-kids">
          {tree.length ? (
            tree.map((n, i) => (
              <FileBranch
                key={i}
                node={n}
                depth={0}
                path={n.name}
                spaceId={space.id}
                rootId={root.id}
                forceOpen={!!q}
              />
            ))
          ) : (
            <div className="arc-lib-empty">{q ? '没有匹配的文件' : '这个文件夹还没有文件'}</div>
          )}
        </div>
      )}
    </div>
  )
}

function SpaceLibrary({ space, query }: { space: Space; query: string }) {
  const folders = useStore((s) => s.folders)
  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)
  const openAddFolder = useUI((s) => s.openAddFolder)
  const openSaveWorkspace = useUI((s) => s.openSaveWorkspace)
  const q = query.trim().toLowerCase()

  // A connected space: N mount roots side by side, each its own tree — the
  // multi-folder workspace. 单文件夹只是 roots.length === 1 的特例，没有第二种模式。
  if (!isCloudStorage(space.storage)) {
    const roots = space.roots ?? []
    const matches = q
      ? files.some((f) => f.spaceId === space.id && f.path.toLowerCase().includes(q))
      : true
    return (
      <div className="arc-lib" key={space.id}>
        {roots.length > 1 && !space.workspaceSaved && !q && (
          <div className="arc-ws-hint">
            <span className="ws-truncate">{roots.length} 个文件夹 · 未保存为工作区</span>
            <button className="arc-ws-save" onClick={openSaveWorkspace}>
              保存…
            </button>
          </div>
        )}
        {roots.map((r, i) => (
          <RootSection
            key={r.id}
            space={space}
            root={r}
            index={i}
            query={query}
            removable={roots.length > 1}
          />
        ))}
        {q && !matches && <div className="arc-lib-empty">没有匹配的文件</div>}
        {!roots.length && (
          <div className="arc-lib-empty">
            这个空间还没有打开任何文件夹。
          </div>
        )}
        {!q && (
          <button className="arc-add-root" onClick={openAddFolder} title="把另一个文件夹添加进当前空间，和现有文件夹并排打开">
            <FolderPlus size={13} />
            <span>添加文件夹…</span>
          </button>
        )}
      </div>
    )
  }

  // Wordspace cloud: a team-shared section and a private one, scoped to THIS
  // space — cloud spaces are isolated workspaces, like Notion.
  const team = folders
    .filter((f) => f.spaceId === space.id && f.scope === 'team')
    .sort((a, b) => a.order - b.order)
  const personal = folders
    .filter((f) => f.spaceId === space.id && f.scope === 'personal')
    .sort((a, b) => a.order - b.order)
  const folderIds = new Set([...team, ...personal].map((f) => f.id))
  const hasDocs = docs.some((d) => folderIds.has(d.folderId) && !d.unsaved)
  const matches = q
    ? docs.some((d) => folderIds.has(d.folderId) && !d.unsaved && d.title.toLowerCase().includes(q))
    : true
  return (
    <div className="arc-lib" key={space.id}>
      {!hasDocs ? (
        <div className="arc-lib-empty">这个空间还没有文档，点上方「标签页」右边的 + 新建。</div>
      ) : q && !matches ? (
        <div className="arc-lib-empty">没有匹配的文档</div>
      ) : (
        <>
          {team.length > 0 && <div className="arc-sec-label">团队共享</div>}
          {team.map((f) => (
            <FolderGroup key={f.id} folder={f} query={query} />
          ))}
          {personal.length > 0 && <div className="arc-sec-label">我的私有</div>}
          {personal.map((f) => (
            <FolderGroup key={f.id} folder={f} query={query} />
          ))}
        </>
      )}
    </div>
  )
}

function SpaceSwitcher() {
  const { spaces, activeSpaceId, setActiveSpace } = useStore()
  const openSpaceModal = useUI((s) => s.openSpaceModal)
  const active = spaces.find((s) => s.id === activeSpaceId)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const cloud = spaces.filter((s) => isCloudStorage(s.storage))
  const connected = spaces.filter((s) => !isCloudStorage(s.storage))
  const item = (s: Space) => {
    const Icon = s.storage === 'local' ? HardDrive : Cloud
    return (
      <button
        key={s.id}
        className={`arc-space-item ${s.id === activeSpaceId ? 'is-active' : ''}`}
        onClick={() => {
          setActiveSpace(s.id)
          setOpen(false)
        }}
      >
        <SpaceIcon space={s} />
        <span className="arc-space-item-text">
          <span className="arc-space-item-name ws-truncate">
            {s.name}
            {/* 已保存的多文件夹组合带「工作区」徽标（消歧用，仿 VS Code Open Recent 的 "(Workspace)"） */}
            {s.workspaceSaved && (s.roots?.length ?? 0) > 1 && (
              <span className="arc-space-ws-badge">工作区</span>
            )}
          </span>
          <span className="arc-space-item-sub ws-truncate">
            <Icon size={11} />
            {spaceDetail(s)}
          </span>
        </span>
        {s.id === activeSpaceId && <Check size={15} className="arc-space-check" />}
      </button>
    )
  }
  return (
    <div className="arc-spaces" ref={ref}>
      <button className="arc-space-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="arc-space-title ws-truncate">{active?.name}</span>
        {active && (
          <span className="arc-space-trig-ic">
            {active.storage === 'local' ? <HardDrive size={13} /> : <Cloud size={13} />}
          </span>
        )}
        <ChevronDown size={14} className={`arc-space-chev ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <div className="arc-space-menu">
          {/* local-first: connected folders lead; Wordspace cloud comes later */}
          {connected.length > 0 && <div className="arc-space-group">连接的文件夹</div>}
          {connected.map(item)}
          {cloud.length > 0 && <div className="arc-space-group">Wordspace 云盘</div>}
          {cloud.map(item)}
          <button
            className="arc-space-new"
            onClick={() => {
              setOpen(false)
              openSpaceModal()
            }}
          >
            <Plus size={14} />
            <span>新建空间</span>
          </button>
        </div>
      )}
    </div>
  )
}

// The collapsed (48px) sidebar: a condensed icon rail of the active space —
// its badge, open tabs, and top-level folders — each with a hover bubble that
// previews its name + contents. Click a folder/badge to expand; a tab to switch.
export default function ArcSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    tabs,
    activeTabId,
    getDoc,
    spaces,
    activeSpaceId,
    setActiveSpace,
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
  const space = spaces.find((s) => s.id === activeSpaceId) ?? spaces[0]
  const isLocal = !doc?.publishedUrl || doc.visibility === 'private' || doc.visibility === 'invited'

  const [omni, setOmni] = useState(activeTab?.url ?? '')
  useEffect(() => {
    setOmni(activeTab?.url ?? '')
  }, [activeTabId, activeTab?.url])

  // file-tree quick filter (the real "search my files", separate from the web omnibox)
  const [query, setQuery] = useState('')
  useEffect(() => {
    setQuery('')
  }, [activeSpaceId])

  // 全局快捷键：Cmd/Ctrl+\ 收起/展开侧栏；Cmd+T 新建（开 Arc modal）；Cmd+S 假装保存；Cmd+P 查找文件。
  // 注意：浏览器会抢 Cmd+T/Cmd+W，所以 Cmd+T 这条主要在真 Electron app 里生效，网页 demo 里多半被浏览器吞掉。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        openNewTab()
      } else if ((e.key === 's' || e.key === 'S') && !e.shiftKey) {
        e.preventDefault()
        saveActiveDoc()
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        openFind()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleSidebar, openNewTab, saveActiveDoc, openFind])

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

  const wheelLock = useRef(0)
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > 28 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2) {
      const t = Date.now()
      if (t - wheelLock.current < 600) return
      wheelLock.current = t
      const idx = spaces.findIndex((s) => s.id === activeSpaceId)
      const dir = e.deltaX > 0 ? 1 : -1
      setActiveSpace(spaces[(idx + dir + spaces.length) % spaces.length].id)
    }
  }

  const util = [
    { to: '/templates', icon: LayoutTemplate, label: '模板' },
    { to: '/schema', icon: Shapes, label: 'Schema' },
    { to: '/agents', icon: Bot, label: 'AI 接入' },
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
          <button className="arc-ico" title="查找文件 ⌘P" onClick={openFind}><Search size={14} /></button>
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

      <div className="arc-space-bar">
        <SpaceSwitcher />
      </div>

      <div className="arc-scroll" onWheel={onWheel} ref={scrollRef}>
        <div className="arc-section-label">置顶</div>
        <TabStrip spaceId={activeSpaceId} pinned emptyHint="把标签页拖到这里置顶" />

        <div className="arc-section-label arc-tabs-label">
          <span>标签页</span>
          <button className="arc-ico arc-ico-sm" title="新建标签页" onClick={onNewTab}>
            <Plus size={14} />
          </button>
        </div>
        <TabStrip spaceId={activeSpaceId} pinned={false} />

        <div className="arc-section-label">文档</div>
        <div className="arc-filter">
          <Search size={13} className="arc-filter-ico" />
          <input
            className="arc-filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选当前空间的文件"
            spellCheck={false}
          />
          {query && (
            <button className="arc-filter-clear" title="清除" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <SpaceLibrary space={space} query={query} />
      </div>

      <div className="arc-foot">
        <div className="arc-util">
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
