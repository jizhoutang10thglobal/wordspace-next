// ============================================================================
// Wordspace mock data model — the shared contract for every feature module.
// There is no backend. Everything below lives in the browser (zustand + a
// localStorage snapshot) and is mutated through the store in src/mock/store.ts.
// ============================================================================

export type Section = 'docs' | 'templates' | 'agents' | 'settings'

/** Who can see a document. The single dial that runs from private to public. */
export type Visibility = 'private' | 'invited' | 'internal' | 'public'

/** A document is a plain doc, a designed web page, or a slide deck. */
export type DocKind = 'doc' | 'page' | 'slides'

export type BlockType =
  | 'heading'
  | 'text'
  | 'list'
  | 'quote'
  | 'image'
  | 'divider'
  | 'callout'
  | 'embed'

/**
 * A movable, in-place-editable unit. `html` is the rendered inner content.
 * `designed` marks a free-form, AI-authored region (the "B" style from the
 * design discussion) that the light editor treats as a single block.
 */
export interface Block {
  id: string
  type: BlockType
  html: string
  level?: 1 | 2 | 3
  designed?: boolean
}

export interface Doc {
  id: string
  title: string
  emoji?: string
  kind: DocKind
  folderId: string
  blocks: Block[]
  visibility: Visibility
  publishedUrl?: string
  localPath: string // e.g. ~/Wordspace/团队/员工手册.html
  updatedAt: number
  updatedBy: string // member id
  collaborators: string[] // member ids with access
  deployedAt?: number
}

export interface Folder {
  id: string
  name: string
  scope: 'team' | 'personal' // 团队空间 / 我的草稿
  order: number
}

export interface Member {
  id: string
  name: string
  initials: string
  color: string
  email: string
  kind: 'human' | 'agent'
}

export interface Template {
  id: string
  name: string
  kind: DocKind
  category: string // 手册 / 标书 / 演示 / 落地页
  pool: 'private' | 'public'
  description: string
  accent: string
  blocks: Block[]
}

export interface AgentEvent {
  id: string
  agentName: string
  agentColor: string
  action: 'create' | 'read' | 'publish' | 'update'
  docTitle: string
  at: number
}

export interface Workspace {
  id: string
  name: string
  plan: string
  storagePath: string // local repo root, owned by the user
  deployTarget: string // the company-controlled cloud / self-host target
  syncedAt: number
}

/**
 * An Arc-style Space: a switchable context shown in the left sidebar.
 * Spaces are swiped left/right. A space scopes which library the sidebar shows
 * (the team workspace, the on-disk local repo, personal drafts).
 */
export interface Space {
  id: string
  name: string
  kind: 'team' | 'local' | 'personal'
  badge: string // short label shown in the switcher
  color: string
  subtitle: string
}

/** A simulated remote collaborator caret living inside the open document. */
export interface Presence {
  memberId: string
  blockId: string
  label: boolean // show the name flag
}

export interface Tab {
  id: string
  docId?: string
  kind: 'doc' | 'web'
  title: string
  url: string // address-bar string (local path or https url)
  favicon?: string
}

export interface Toast {
  id: string
  message: string
  tone: 'neutral' | 'success' | 'progress' | 'danger'
}

export const VISIBILITY_META: Record<
  Visibility,
  { label: string; short: string; desc: string; color: string }
> = {
  private: {
    label: '仅自己',
    short: '私有',
    desc: '只存在你的本地仓库,只有你能看到。',
    color: 'var(--c-private)',
  },
  invited: {
    label: '受邀协作者',
    short: '协作',
    desc: '邀请指定成员共同编辑或查看。',
    color: 'var(--c-invited)',
  },
  internal: {
    label: '公司内网',
    short: '内网',
    desc: '部署到公司内网,组织内成员可访问。',
    color: 'var(--c-internal)',
  },
  public: {
    label: '互联网公开',
    short: '公开',
    desc: '生成公开地址,任何人都能打开,等同一处对外站点。',
    color: 'var(--c-public)',
  },
}
