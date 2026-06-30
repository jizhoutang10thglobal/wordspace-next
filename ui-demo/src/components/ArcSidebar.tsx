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
import type { Doc, FileEntry, FileKind, Folder, Space, Tab } from '../types'
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
            closeTab(tab.id)
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
    s.docs.filter((d) => d.folderId === folder.id).sort((a, b) => b.updatedAt - a.updatedAt),
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
  forceOpen,
}: {
  node: FileNode
  depth: number
  path: string
  spaceId: string
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
  const openState = useUI((s) => !s.collapsedKeys['file:' + path])
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
    const isActive = !!activeTab?.fileName && activeTab.url === f.path
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
            if (!cancelRename.current) renameDir(path, e.currentTarget.value)
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
  const newDocHere = () => openCreate(path)
  return (
    <div className="arc-tree-dir">
      <div
        className={`arc-folder-head ${dropOver ? 'is-drop' : ''}`}
        role="button"
        tabIndex={0}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => toggle('file:' + path)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle('file:' + path)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          // skip if no file dragged, cross-space, or already in this folder
          if (!dragFile || dragFile.spaceId !== spaceId || parentDir(dragFile.path) === path) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          clearDrop = () => setDropOver(false)
          setDropOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false)
        }}
        onDrop={(e) => {
          if (!dragFile || dragFile.spaceId !== spaceId) return
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
            { label: '新建子文件夹', onClick: () => createSubfolder(path) },
            { label: '重命名', onClick: () => setRenaming(true) },
            { label: '删除', danger: true, onClick: () => deleteDirWithUndo(path) },
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
// group header, so this shows the useful bit: capability for cloud, path for a
// connected folder.
function spaceDetail(space: Space): string {
  if (isCloudStorage(space.storage)) return '实时协作、Agent'
  return space.mountPath ?? space.subtitle
}

function SpaceLibrary({ space, query }: { space: Space; query: string }) {
  const folders = useStore((s) => s.folders)
  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)
  const dirs = useStore((s) => s.dirs)
  const moveFile = useStore((s) => s.moveFile)
  const q = query.trim().toLowerCase()
  const [rootDrop, setRootDrop] = useState(false)

  // A connected folder: browse the whole mount, every file type, not just docs.
  if (!isCloudStorage(space.storage)) {
    const mine = files.filter((f) => f.spaceId === space.id)
    const shown = q ? mine.filter((f) => f.path.toLowerCase().includes(q)) : mine
    const spaceDirs = q ? [] : dirs.filter((d) => d.spaceId === space.id).map((d) => d.path)
    const tree = buildFileTree(shown, spaceDirs)
    const drive = space.storage === 'gdrive'
    return (
      <div className="arc-lib" key={space.id}>
        <div
          className={`arc-connected ${rootDrop ? 'is-drop' : ''}`}
          title="连接进来的外部文件夹 · 拖文件到这里可移到根目录"
          onDragOver={(e) => {
            // skip if no file dragged, cross-space, or already at the root
            if (!dragFile || dragFile.spaceId !== space.id || parentDir(dragFile.path) === '') return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            clearDrop = () => setRootDrop(false)
            setRootDrop(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setRootDrop(false)
          }}
          onDrop={(e) => {
            if (!dragFile || dragFile.spaceId !== space.id) return
            e.preventDefault()
            setRootDrop(false)
            clearDrop = null
            moveFile(dragFile, '')
          }}
        >
          {drive ? <Cloud size={12} /> : <HardDrive size={12} />}
          <span className="ws-truncate">
            {space.mountPath ?? (drive ? 'Google Drive' : '本地文件夹')}
          </span>
        </div>
        {tree.length ? (
          tree.map((n, i) => (
            <FileBranch key={i} node={n} depth={0} path={n.name} spaceId={space.id} forceOpen={!!q} />
          ))
        ) : (
          <div className="arc-lib-empty">{q ? '没有匹配的文件' : '这个文件夹还没有文件'}</div>
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
  const hasDocs = docs.some((d) => folderIds.has(d.folderId))
  const matches = q
    ? docs.some((d) => folderIds.has(d.folderId) && d.title.toLowerCase().includes(q))
    : true
  return (
    <div className="arc-lib" key={space.id}>
      {!hasDocs ? (
        <div className="arc-lib-empty">这个空间还没有文档,点上面的 + 新建一篇。</div>
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
          <span className="arc-space-item-name ws-truncate">{s.name}</span>
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
function CollapsedRail() {
  const navigate = useNavigate()
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const activeSpaceId = useStore((s) => s.activeSpaceId)
  const spaces = useStore((s) => s.spaces)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const folders = useStore((s) => s.folders)
  const docs = useStore((s) => s.docs)
  const files = useStore((s) => s.files)
  const dirs = useStore((s) => s.dirs)
  const expand = useUI((s) => s.toggleSidebar)
  const [pop, setPop] = useState<{ top: number; title: string; sub?: string; items: string[] } | null>(null)

  const space = spaces.find((s) => s.id === activeSpaceId)
  const spaceTabs = tabs.filter((t) => t.spaceId === activeSpaceId)
  const tabItems = [...spaceTabs.filter((t) => t.pinned), ...spaceTabs.filter((t) => !t.pinned)]

  // Top-level folder groups for the active space (cloud folders or tree dirs).
  let groups: { id: string; name: string; items: string[] }[] = []
  if (space && isCloudStorage(space.storage)) {
    groups = folders
      .filter((f) => f.spaceId === space.id)
      .sort((a, b) => a.order - b.order)
      .map((f) => ({
        id: f.id,
        name: f.name,
        items: docs
          .filter((d) => d.folderId === f.id)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((d) => d.title),
      }))
  } else if (space) {
    const tree = buildFileTree(
      files.filter((f) => f.spaceId === space.id),
      dirs.filter((d) => d.spaceId === space.id).map((d) => d.path),
    )
    groups = tree
      .filter((n) => !n.file)
      .map((n) => ({ id: n.name, name: n.name, items: n.children.map((c) => c.name) }))
  }

  const showPop = (e: React.MouseEvent, title: string, items: string[], sub?: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPop({ top: r.top, title, items, sub })
  }
  const hide = () => setPop(null)

  return (
    <>
      <div className="arc-rail">
        {space && (
          <button
            className="arc-rail-badge-btn"
            onMouseEnter={(e) =>
              showPop(
                e,
                space.name,
                [],
                space.storage === 'local'
                  ? '本地文件夹'
                  : space.storage === 'gdrive'
                    ? 'Google Drive'
                    : 'Wordspace 云盘',
              )
            }
            onMouseLeave={hide}
            onClick={expand}
            title=""
          >
            <span className="arc-rail-badge" style={{ background: space.color }}>
              {space.badge}
            </span>
          </button>
        )}
        {(tabItems.length > 0 || groups.length > 0) && <div className="arc-rail-div" />}
        {tabItems.map((t) => (
          <button
            key={t.id}
            className={`arc-rail-ico ${t.id === activeTabId ? 'is-active' : ''}`}
            onMouseEnter={(e) => showPop(e, t.title, [])}
            onMouseLeave={hide}
            onClick={() => {
              setActiveTab(t.id)
              navigate('/docs')
            }}
          >
            {t.kind === 'web' ? (
              <Globe2 size={15} />
            ) : t.fileKind ? (
              <FileIcon kind={t.fileKind} />
            ) : (
              <FileText size={15} />
            )}
          </button>
        ))}
        {tabItems.length > 0 && groups.length > 0 && <div className="arc-rail-div" />}
        {groups.map((g) => (
          <button
            key={g.id}
            className="arc-rail-ico arc-rail-folder"
            onMouseEnter={(e) => showPop(e, g.name, g.items, g.items.length ? undefined : '空文件夹')}
            onMouseLeave={hide}
            onClick={expand}
          >
            <FolderClosed size={15} />
          </button>
        ))}
      </div>
      {pop && (
        <div className="arc-rail-pop" style={{ top: pop.top }}>
          <div className="arc-rail-pop-title ws-truncate">{pop.title}</div>
          {pop.sub && <div className="arc-rail-pop-sub">{pop.sub}</div>}
          {pop.items.length > 0 && (
            <div className="arc-rail-pop-list">
              {pop.items.slice(0, 8).map((n, i) => (
                <div key={i} className="arc-rail-pop-item ws-truncate">
                  {n}
                </div>
              ))}
              {pop.items.length > 8 && (
                <div className="arc-rail-pop-more">+{pop.items.length - 8} 项</div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

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
    openCreate,
  } = { ...useStore(), openCreate: useUI((s) => s.openCreate) }
  const me = useStore((s) => s.getMember(s.meId))
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const toggleSidebar = useUI((s) => s.toggleSidebar)

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

  // Cmd/Ctrl+\ toggles the sidebar (maps to the existing 收起/展开侧栏 action).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

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
    newBrowserTab()
    navigate('/docs')
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
    { to: '/agents', icon: Bot, label: 'Agent' },
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
        <CollapsedRail />
      </aside>
    )
  }

  return (
    <aside className="arc-sidebar">
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

      <div className="arc-scroll" onWheel={onWheel}>
        <div className="arc-section-label">置顶</div>
        <TabStrip spaceId={activeSpaceId} pinned emptyHint="把标签页拖到这里置顶" />

        <div className="arc-section-label arc-tabs-label">
          <span>标签页</span>
          <button className="arc-ico arc-ico-sm" title="新建标签页" onClick={onNewTab}>
            <Plus size={14} />
          </button>
        </div>
        <TabStrip spaceId={activeSpaceId} pinned={false} />

        <div className="arc-section-label arc-tabs-label">
          <span>文档</span>
          <button className="arc-ico arc-ico-sm" title="在此空间新建" onClick={() => openCreate()}>
            <Plus size={14} />
          </button>
        </div>
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
