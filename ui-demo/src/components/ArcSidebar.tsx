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
  Globe2,
  Cloud,
  HardDrive,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File,
  Pin,
  PinOff,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useBrowser } from '../mock/browser'
import { Avatar } from '../ui/primitives'
import { buildFileTree, type FileNode } from '../lib/tree'
import { isCloudStorage } from '../types'
import type { Doc, FileKind, Folder, Space, Tab } from '../types'
import './ArcSidebar.css'

// ---------------------------------------------------------------------------
// Drag and drop. 置顶 and 标签页 both hold tabs, so there is one drag kind: a tab
// dropped into the 置顶 zone becomes pinned, into the 标签页 zone becomes
// unpinned, and within a zone it reorders. getData() is blocked during dragover,
// so the dragged id is stashed module-side. Same-document only.
// ---------------------------------------------------------------------------
let dragTabId: string | null = null

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

function FolderGroup({ folder }: { folder: Folder }) {
  const docs = useStore((s) =>
    s.docs.filter((d) => d.folderId === folder.id).sort((a, b) => b.updatedAt - a.updatedAt),
  )
  const key = 'folder:' + folder.id
  const open = useUI((s) => !s.collapsedKeys[key])
  const toggle = useUI((s) => s.toggleCollapsed)
  if (!docs.length) return null
  return (
    <div className="arc-folder">
      <button className="arc-folder-head" onClick={() => toggle(key)}>
        <ChevronRight size={12} className={`arc-caret ${open ? 'is-open' : ''}`} />
        <FolderClosed size={13} />
        <span className="ws-truncate">{folder.name}</span>
      </button>
      {open && docs.map((d) => <DocRow key={d.id} doc={d} />)}
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
// opens a hand-off tab. Right-click a file for open / rename / delete.
function FileBranch({ node, depth, path }: { node: FileNode; depth: number; path: string }) {
  const navigate = useNavigate()
  const openFileTab = useStore((s) => s.openFileTab)
  const renameFile = useStore((s) => s.renameFile)
  const deleteFile = useStore((s) => s.deleteFile)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const open = useUI((s) => !s.collapsedKeys['file:' + path])
  const toggle = useUI((s) => s.toggleCollapsed)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const cancelRename = useRef(false)

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
              { label: '删除', danger: true, onClick: () => deleteFile(f) },
            ]}
          />
        )}
      </>
    )
  }
  return (
    <div className="arc-tree-dir">
      <button
        className="arc-folder-head"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => toggle('file:' + path)}
      >
        <ChevronRight size={12} className={`arc-caret ${open ? 'is-open' : ''}`} />
        <FolderClosed size={13} />
        <span className="ws-truncate">{node.name}</span>
      </button>
      {open &&
        node.children.map((c, i) => (
          <FileBranch key={i} node={c} depth={depth + 1} path={`${path}/${c.name}`} />
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

function SpaceLibrary({ space }: { space: Space }) {
  const folders = useStore((s) => s.folders)
  const files = useStore((s) => s.files)
  const docs = useStore((s) => s.docs)

  // A connected folder: browse the whole mount, every file type, not just docs.
  if (!isCloudStorage(space.storage)) {
    const tree = buildFileTree(files.filter((f) => f.spaceId === space.id))
    const drive = space.storage === 'gdrive'
    return (
      <div className="arc-lib" key={space.id}>
        <div className="arc-connected" title="这是一个连接进来的外部文件夹">
          {drive ? <Cloud size={12} /> : <HardDrive size={12} />}
          <span className="ws-truncate">
            {space.mountPath ?? (drive ? 'Google Drive' : '本地文件夹')}
          </span>
        </div>
        {tree.length ? (
          tree.map((n, i) => <FileBranch key={i} node={n} depth={0} path={n.name} />)
        ) : (
          <div className="arc-lib-empty">这个文件夹还没有文件</div>
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
  return (
    <div className="arc-lib" key={space.id}>
      {!hasDocs ? (
        <div className="arc-lib-empty">这个空间还没有文档,点上面的 + 新建一篇。</div>
      ) : (
        <>
          {team.length > 0 && <div className="arc-sec-label">团队共享</div>}
          {team.map((f) => (
            <FolderGroup key={f.id} folder={f} />
          ))}
          {personal.length > 0 && <div className="arc-sec-label">我的私有</div>}
          {personal.map((f) => (
            <FolderGroup key={f.id} folder={f} />
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
          <div className="arc-space-group">Wordspace 云盘</div>
          {cloud.map(item)}
          {connected.length > 0 && <div className="arc-space-group">连接的文件夹</div>}
          {connected.map(item)}
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
          <button className="arc-ico arc-ico-sm" title="在此空间新建" onClick={openCreate}>
            <Plus size={14} />
          </button>
        </div>
        <SpaceLibrary space={space} />
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
