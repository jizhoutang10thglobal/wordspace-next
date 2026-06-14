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
  Search,
  LayoutTemplate,
  Bot,
  Settings2,
  Globe2,
} from 'lucide-react'
import { useStore } from '../mock/store'
import { useUI } from '../mock/ui'
import { useBrowser } from '../mock/browser'
import { Avatar, VisibilityDot } from '../ui/primitives'
import { buildLocalTree, type TreeNode } from '../lib/tree'
import type { Doc, Folder, Space, Tab } from '../types'
import './ArcSidebar.css'

function TabRow({ tab }: { tab: Tab }) {
  const { activeTabId, setActiveTab, closeTab } = useStore()
  const active = tab.id === activeTabId
  return (
    <div
      className={`arc-tab ${active ? 'is-active' : ''}`}
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
      <span className="arc-doc-emoji">{doc.emoji ?? '📄'}</span>
      <span className="arc-doc-title ws-truncate">{doc.title}</span>
      <VisibilityDot v={doc.visibility} />
    </button>
  )
}

function FolderGroup({ folder }: { folder: Folder }) {
  const docs = useStore((s) =>
    s.docs.filter((d) => d.folderId === folder.id).sort((a, b) => b.updatedAt - a.updatedAt),
  )
  if (!docs.length) return null
  return (
    <div className="arc-folder">
      <div className="arc-folder-head">
        <FolderClosed size={13} />
        <span>{folder.name}</span>
      </div>
      {docs.map((d) => (
        <DocRow key={d.id} doc={d} />
      ))}
    </div>
  )
}

function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  const navigate = useNavigate()
  const { openDoc, tabs, activeTabId, getDoc } = useStore()
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
      <div className="arc-folder-head" style={{ paddingLeft: 8 + depth * 16 }}>
        <FolderClosed size={13} />
        <span>{node.name}</span>
      </div>
      {node.children.map((c, i) => (
        <TreeBranch key={i} node={c} depth={depth + 1} />
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
          <TreeBranch key={i} node={n} depth={0} />
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
  const idx = spaces.findIndex((s) => s.id === activeSpaceId)
  const active = spaces[idx]
  const move = (dir: number) => {
    const next = (idx + dir + spaces.length) % spaces.length
    setActiveSpace(spaces[next].id)
  }
  return (
    <div className="arc-spaces">
      <button className="arc-space-arrow" onClick={() => move(-1)}>
        <ChevronLeft size={15} />
      </button>
      <div className="arc-space-name">
        <span className="arc-space-title">{active?.name}</span>
        <span className="arc-space-sub ws-truncate">{active?.subtitle}</span>
      </div>
      <div className="arc-space-dots">
        {spaces.map((s) => (
          <button
            key={s.id}
            className={`arc-space-dot ${s.id === activeSpaceId ? 'is-active' : ''}`}
            title={s.name}
            onClick={() => setActiveSpace(s.id)}
            style={{ '--sp-color': s.color } as React.CSSProperties}
          >
            {s.badge}
          </button>
        ))}
      </div>
      <button className="arc-space-arrow" onClick={() => move(1)}>
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

export default function ArcSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { tabs, activeTabId, getDoc, spaces, activeSpaceId, setActiveSpace, newBrowserTab, openCreate } =
    { ...useStore(), openCreate: useUI((s) => s.openCreate) }
  const me = useStore((s) => s.getMember(s.meId))

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

  return (
    <aside className="arc-sidebar">
      <div className="arc-top">
        <div className="arc-traffic">
          <span style={{ background: '#ff5f57' }} />
          <span style={{ background: '#febc2e' }} />
          <span style={{ background: '#28c840' }} />
        </div>
        <div className="arc-top-nav">
          <button className="arc-ico" title="侧栏"><PanelLeft size={15} /></button>
          <button className="arc-ico" title="后退" onClick={goBack}><ChevronLeft size={16} /></button>
          <button className="arc-ico" title="前进" onClick={goForward}><ChevronRight size={16} /></button>
          <button className="arc-ico" title="刷新" onClick={() => navigate('/docs')}><RotateCw size={13} /></button>
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

      <div className="arc-scroll" onWheel={onWheel}>
        <div className="arc-section-label arc-tabs-label">
          <span>标签页</span>
          <button className="arc-ico arc-ico-sm" title="新建标签页" onClick={onNewTab}>
            <Plus size={14} />
          </button>
        </div>
        <div className="arc-tabs">
          {tabs.map((t) => (
            <TabRow key={t.id} tab={t} />
          ))}
        </div>

        <div className="arc-lib-head">
          <span className="ws-truncate">{space?.name}</span>
          <button className="arc-ico arc-ico-sm" title="新建" onClick={openCreate}>
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
          {me && <Avatar member={me} size={24} />}
        </div>
        <SpaceSwitcher />
      </div>
    </aside>
  )
}
