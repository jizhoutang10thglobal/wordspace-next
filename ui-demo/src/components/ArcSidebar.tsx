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
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useBrowser, newBookmarkUid, type Bookmark } from '../mock/browser'
import { Avatar, VisibilityDot } from '../ui/primitives'
import { buildLocalTree, type TreeNode } from '../lib/tree'
import type { Doc, Folder, Space, Tab } from '../types'
import './ArcSidebar.css'

// ---------------------------------------------------------------------------
// Drag and drop. Tabs reorder within 标签页; bookmarks reorder within 收藏; a tab
// dragged onto 收藏 is saved; a bookmark dragged out of 收藏 is removed.
// getData() is blocked during dragover, so the live drag is stashed module-side
// and read for reorder math; the MIME type carries the kind (types ARE readable
// during dragover). Same-document only, which is all this prototype needs.
// ---------------------------------------------------------------------------
const TAB_MIME = 'application/x-ws-tab'
const MARK_MIME = 'application/x-ws-bookmark'
type DragState = { kind: 'tab' | 'bookmark'; id: string }
let activeDrag: DragState | null = null
let bookmarkLanded = false // set when a dragged bookmark lands on the 收藏 zone

type InsertPos = 'before' | 'after'
/** Where to drop, from cursor Y vs the hovered row's midpoint. */
function insertAt(e: React.DragEvent): InsertPos {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return e.clientY > r.top + r.height / 2 ? 'after' : 'before'
}
/** Final array index for "move fromId next to targetId on `pos` side". */
function targetIndex(ids: string[], fromId: string, targetId: string, pos: InsertPos): number {
  const rest = ids.filter((id) => id !== fromId)
  let idx = rest.indexOf(targetId)
  if (idx < 0) return rest.length
  return pos === 'after' ? idx + 1 : idx
}

// A tab becomes a favorite by dragging it onto the 收藏 area. The new-tab start
// page (empty / wordspace:// url) has nothing to bookmark, so it yields null.
function tabToBookmark(tab: Tab, getDoc: (id: string) => Doc | undefined): Bookmark | null {
  if (tab.kind === 'doc' && tab.docId) {
    const d = getDoc(tab.docId)
    return {
      uid: newBookmarkUid(),
      spaceId: tab.spaceId,
      kind: 'doc',
      docId: tab.docId,
      title: d?.title ?? tab.title,
    }
  }
  if (tab.kind === 'web' && tab.url && !tab.url.startsWith('wordspace://')) {
    return { uid: newBookmarkUid(), spaceId: tab.spaceId, kind: 'web', url: tab.url, title: tab.title }
  }
  return null
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
  const { activeTabId, setActiveTab, closeTab } = useStore()
  const active = tab.id === activeTabId
  return (
    <div
      className={`arc-tab ${active ? 'is-active' : ''} ${insert ? 'drop-' + insert : ''}`}
      draggable
      onDragStart={(e) => {
        activeDrag = { kind: 'tab', id: tab.id }
        e.dataTransfer.setData(TAB_MIME, tab.id)
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onDragEnd={() => {
        activeDrag = null
      }}
      onDragOver={onRowDragOver}
      onClick={() => setActiveTab(tab.id)}
    >
      <span className="arc-tab-ico">
        {tab.kind === 'web' ? <Globe2 size={13} /> : <FileText size={13} />}
      </span>
      <span className="arc-tab-title ws-truncate">{tab.title}</span>
      <button
        className="arc-tab-close"
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tab.id)
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function TabStrip({
  spaceId,
  onOpenMark,
}: {
  spaceId: string
  onOpenMark: (markId: string) => string | null
}) {
  const allTabs = useStore((s) => s.tabs)
  const moveTab = useStore((s) => s.moveTab)
  const tabs = allTabs.filter((t) => t.spaceId === spaceId)
  const [insert, setInsert] = useState<{ id: string; pos: InsertPos } | null>(null)

  const onDrop = (e: React.DragEvent) => {
    if (!activeDrag) return
    e.preventDefault()
    const target = insert
    setInsert(null)
    if (activeDrag.kind === 'tab') {
      const fromId = activeDrag.id
      if (target) moveTab(fromId, targetIndex(tabs.map((t) => t.id), fromId, target.id, target.pos))
    } else if (activeDrag.kind === 'bookmark') {
      // Opening a favorite as a tab counts as a landing, so it isn't removed.
      bookmarkLanded = true
      const newId = onOpenMark(activeDrag.id)
      if (newId && target) {
        const ids = useStore.getState().tabs.map((t) => t.id)
        moveTab(newId, targetIndex(ids, newId, target.id, target.pos))
      }
    }
  }
  return (
    <div
      className="arc-tabs"
      onDragOver={(e) => {
        if (!activeDrag) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setInsert(null)
      }}
      onDrop={onDrop}
    >
      {tabs.map((t) => (
        <TabRow
          key={t.id}
          tab={t}
          insert={insert?.id === t.id ? insert.pos : null}
          onRowDragOver={(e) => {
            // both a reordered tab and a favorite being opened show the line
            if (!activeDrag || activeDrag.id === t.id) return
            e.preventDefault()
            setInsert({ id: t.id, pos: insertAt(e) })
          }}
        />
      ))}
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
      <VisibilityDot v={doc.visibility} />
    </button>
  )
}

function BookmarkRow({
  mark,
  insert,
  onRowDragOver,
}: {
  mark: Bookmark
  insert: InsertPos | null
  onRowDragOver: (e: React.DragEvent) => void
}) {
  const navigate = useNavigate()
  const { openDoc, getDoc, openWebTab } = useStore()
  const removeBookmark = useBrowser((s) => s.removeBookmark)
  const doc = mark.kind === 'doc' && mark.docId ? getDoc(mark.docId) : undefined
  // A document bookmark whose doc no longer exists (e.g. after a reseed) is skipped.
  if (mark.kind === 'doc' && !doc) return null
  const title = doc?.title ?? mark.title
  // A favorite is a button: a doc jumps to that document; a web page always opens
  // a fresh tab (duplicate tabs are fine).
  const open = () => {
    if (mark.kind === 'doc' && mark.docId) {
      openDoc(mark.docId)
    } else if (mark.url) {
      openWebTab(mark.url, mark.title)
      useBrowser.getState().navigate(mark.url)
    }
    navigate('/docs')
  }
  return (
    <div
      className={`arc-mark ${insert ? 'drop-' + insert : ''}`}
      draggable
      onDragStart={(e) => {
        activeDrag = { kind: 'bookmark', id: mark.uid }
        bookmarkLanded = false
        e.dataTransfer.setData(MARK_MIME, mark.uid)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        // Dropped anywhere other than the 收藏 zone → drag-out removal.
        if (activeDrag?.kind === 'bookmark' && !bookmarkLanded) removeBookmark(mark.uid)
        activeDrag = null
      }}
      onDragOver={onRowDragOver}
      onClick={open}
    >
      <span className="arc-mark-ico">
        {mark.kind === 'doc' ? <FileText size={13} /> : <Globe2 size={13} />}
      </span>
      <span className="arc-mark-title ws-truncate">{title}</span>
      <button
        className="arc-mark-del"
        title="移除收藏"
        onClick={(e) => {
          e.stopPropagation()
          removeBookmark(mark.uid)
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function MarksStrip({
  spaceId,
  onAddTab,
}: {
  spaceId: string
  onAddTab: (tabId: string) => string | null
}) {
  const allBookmarks = useBrowser((s) => s.bookmarks)
  const moveBookmark = useBrowser((s) => s.moveBookmark)
  const bookmarks = allBookmarks.filter((b) => b.spaceId === spaceId)
  const [insert, setInsert] = useState<{ id: string; pos: InsertPos } | null>(null)
  const [tabOver, setTabOver] = useState(false)

  const onZoneDragOver = (e: React.DragEvent) => {
    if (!activeDrag) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Empty 收藏 has no rows to draw an insertion line on, so highlight the zone.
    if (activeDrag.kind === 'tab' && bookmarks.length === 0) setTabOver(true)
  }
  const onZoneDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const target = insert
    setInsert(null)
    if (activeDrag?.kind === 'tab') {
      setTabOver(false)
      const newUid = onAddTab(e.dataTransfer.getData(TAB_MIME) || activeDrag.id)
      // Drop it where the insertion line was, like a reorder.
      if (newUid && target) {
        const uids = useBrowser.getState().bookmarks.map((b) => b.uid)
        moveBookmark(newUid, targetIndex(uids, newUid, target.id, target.pos))
      }
      return
    }
    if (activeDrag?.kind === 'bookmark') {
      bookmarkLanded = true
      const fromUid = activeDrag.id
      if (target) {
        moveBookmark(fromUid, targetIndex(bookmarks.map((b) => b.uid), fromUid, target.id, target.pos))
      }
    }
  }
  return (
    <div
      className={`arc-marks-zone ${tabOver ? 'is-drop' : ''}`}
      onDragOver={onZoneDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setTabOver(false)
          setInsert(null)
        }
      }}
      onDrop={onZoneDrop}
    >
      <div className="arc-section-label">收藏</div>
      {bookmarks.length > 0 ? (
        <div className="arc-marks">
          {bookmarks.map((b) => (
            <BookmarkRow
              key={b.uid}
              mark={b}
              insert={insert?.id === b.uid ? insert.pos : null}
              onRowDragOver={(e) => {
                // both a reordered bookmark and a tab being saved show the line
                if (!activeDrag || activeDrag.id === b.uid) return
                e.preventDefault()
                setInsert({ id: b.uid, pos: insertAt(e) })
              }}
            />
          ))}
        </div>
      ) : (
        <div className="arc-marks-empty">把标签页拖到这里收藏</div>
      )}
    </div>
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

function TreeBranch({ node, depth, path }: { node: TreeNode; depth: number; path: string }) {
  const navigate = useNavigate()
  const { openDoc, tabs, activeTabId, getDoc } = useStore()
  const key = 'tree:' + path
  const open = useUI((s) => !s.collapsedKeys[key])
  const toggle = useUI((s) => s.toggleCollapsed)
  const activeDocId = tabs.find((t) => t.id === activeTabId)?.docId
  if (node.docId) {
    const doc = getDoc(node.docId)
    return (
      <button
        className={`arc-file ${node.docId === activeDocId ? 'is-active' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={() => {
          openDoc(node.docId!)
          navigate('/docs')
        }}
      >
        <FileText size={13} className="arc-file-ico" />
        <span className="ws-truncate">{node.name}</span>
        {doc && <VisibilityDot v={doc.visibility} />}
      </button>
    )
  }
  return (
    <div className="arc-tree-dir">
      <button
        className="arc-folder-head"
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => toggle(key)}
      >
        <ChevronRight size={12} className={`arc-caret ${open ? 'is-open' : ''}`} />
        <FolderClosed size={13} />
        <span className="ws-truncate">{node.name}</span>
      </button>
      {open &&
        node.children.map((c, i) => (
          <TreeBranch key={i} node={c} depth={depth + 1} path={`${path}/${c.name}`} />
        ))}
    </div>
  )
}

function SpaceLibrary({ space }: { space: Space }) {
  const folders = useStore((s) => s.folders)
  const docs = useStore((s) => s.docs)

  if (space.kind === 'local') {
    const tree = buildLocalTree(docs)
    return (
      <div className="arc-lib" key={space.id}>
        <div className="arc-lib-root">
          <FolderClosed size={13} /> ~/Wordspace
        </div>
        {tree.map((n, i) => (
          <TreeBranch key={i} node={n} depth={0} path={n.name} />
        ))}
      </div>
    )
  }

  const scope = space.kind === 'team' ? 'team' : 'personal'
  const list = folders.filter((f) => f.scope === scope).sort((a, b) => a.order - b.order)
  return (
    <div className="arc-lib" key={space.id}>
      {list.map((f) => (
        <FolderGroup key={f.id} folder={f} />
      ))}
    </div>
  )
}

function SpaceSwitcher() {
  const { spaces, activeSpaceId, setActiveSpace } = useStore()
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
  return (
    <div className="arc-spaces" ref={ref}>
      <button className="arc-space-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="arc-space-title ws-truncate">{active?.name}</span>
        <ChevronDown size={14} className={`arc-space-chev ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <div className="arc-space-menu">
          {spaces.map((s) => (
            <button
              key={s.id}
              className={`arc-space-item ${s.id === activeSpaceId ? 'is-active' : ''}`}
              onClick={() => {
                setActiveSpace(s.id)
                setOpen(false)
              }}
            >
              <span className="arc-space-bullet" style={{ background: s.color }} />
              <span className="arc-space-item-text">
                <span className="arc-space-item-name ws-truncate">{s.name}</span>
                <span className="arc-space-item-sub ws-truncate">{s.subtitle}</span>
              </span>
              {s.id === activeSpaceId && <Check size={14} className="arc-space-check" />}
            </button>
          ))}
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
    openDoc,
    openWebTab,
    openCreate,
  } = { ...useStore(), openCreate: useUI((s) => s.openCreate) }
  const me = useStore((s) => s.getMember(s.meId))
  const collapsed = useUI((s) => s.sidebarCollapsed)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const addBookmark = useBrowser((s) => s.addBookmark)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const doc = activeTab?.docId ? getDoc(activeTab.docId) : undefined
  const space = spaces.find((s) => s.id === activeSpaceId) ?? spaces[0]
  const isLocal = !doc?.publishedUrl || doc.visibility === 'private' || doc.visibility === 'invited'

  // Dropping a dragged tab onto the 收藏 area saves it as a favorite (returns the
  // new bookmark id so the drop can position it where the insertion line was).
  const addTabToMarks = (tabId: string): string | null => {
    const tab = tabs.find((t) => t.id === tabId)
    const bm = tab && tabToBookmark(tab, getDoc)
    if (!bm) return null
    addBookmark(bm)
    return bm.uid
  }

  // The mirror: dropping a favorite onto 标签页 opens it as a tab (returns the
  // resulting tab id so the drop can position it).
  const openMarkAsTab = (markUid: string): string | null => {
    const mark = useBrowser.getState().bookmarks.find((b) => b.uid === markUid)
    if (!mark) return null
    if (mark.kind === 'doc' && mark.docId) {
      openDoc(mark.docId)
    } else if (mark.url) {
      openWebTab(mark.url, mark.title)
      useBrowser.getState().navigate(mark.url)
    }
    navigate('/docs')
    return useStore.getState().activeTabId
  }

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
        <MarksStrip spaceId={activeSpaceId} onAddTab={addTabToMarks} />

        <div className="arc-section-label arc-tabs-label">
          <span>标签页</span>
          <button className="arc-ico arc-ico-sm" title="新建标签页" onClick={onNewTab}>
            <Plus size={14} />
          </button>
        </div>
        <TabStrip spaceId={activeSpaceId} onOpenMark={openMarkAsTab} />

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
