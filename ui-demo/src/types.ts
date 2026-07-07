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

/**
 * Optional paper format for "格式模板"。把文档画布约束到一张实际纸的宽度
 * （A4/A3/A5/书信），服务于打印 / 导出 PDF 的版式。缺省 = 不限纸张（默认列宽）。
 */
export type PageFormat = 'A4' | 'A3' | 'A5' | 'letter'

/** 各纸张的版面元数据：宽（CSS px @96dpi）+ 给卡片预览/标签用的展示信息。 */
export const PAGE_FORMAT_META: Record<
  PageFormat,
  { label: string; size: string; widthPx: number; ratio: number }
> = {
  A4: { label: 'A4', size: '210 × 297 mm', widthPx: 794, ratio: 210 / 297 },
  A3: { label: 'A3', size: '297 × 420 mm', widthPx: 1123, ratio: 297 / 420 },
  A5: { label: 'A5', size: '148 × 210 mm', widthPx: 559, ratio: 148 / 210 },
  letter: { label: '书信', size: '215 × 279 mm', widthPx: 816, ratio: 216 / 279 },
}

export type BlockType =
  | 'heading'
  | 'text'
  | 'list'
  | 'quote'
  | 'image'
  | 'divider'
  | 'callout'
  | 'embed'

/** 列表三态：type 仍是 'list'，listStyle 区分无序 / 编号 / 待办。缺省按 bulleted。 */
export type ListStyle = 'bulleted' | 'numbered' | 'todo'

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
  listStyle?: ListStyle // 仅 type==='list' 有意义
  designed?: boolean
}

export interface Doc {
  id: string
  title: string
  emoji?: string
  kind: DocKind
  pageFormat?: PageFormat // 格式模板生成的文档带上纸张版面（A4/A5/书信…）；缺省=默认列宽
  folderId: string
  blocks: Block[]
  // 野生 / 非合规 HTML 文件（打开后由校验器判定不符合 Schema → 走基础编辑，不拆成 blocks）。
  // 设了它的文档不进块编辑器（Canvas），改进 BasicEditor。仅演示「非合规降级」用。
  rawHtml?: string
  visibility: Visibility
  publishedUrl?: string
  localPath: string // e.g. ~/Wordspace/团队/员工手册.html
  updatedAt: number
  updatedBy: string // member id
  collaborators: string[] // member ids with access
  deployedAt?: number
  // 从「标签页 +」新建、还没手动保存的临时文档：只作为标签页存在，不进文件树/库；
  // Cmd+S / 「保存」按钮才把它落进当前空间。标签页在心智里是临时的（Wendi 反馈）。
  unsaved?: boolean
  // 后端序列化格式（Feature: markdown 文件阅读编辑器）。缺省 = html；'markdown' = 这份文档存成 .md，
  // 块模型 ↔ Markdown 双向（见 lib/markdown.ts）。前端 UI 与 html 文档完全一致。
  format?: 'html' | 'markdown'
}

export interface Folder {
  id: string
  name: string
  scope: 'team' | 'personal' // 团队共享 / 我的私有（都属于唯一的 Wordspace 云盘）
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
  pageFormat?: PageFormat // 设了 = 这是「格式模板」（按纸张版面），卡片显示纸张比例与尺寸
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
 * 侧栏顶层打开的一个根文件夹（多文件夹：同时打开多个、拖动排序、持久化）。
 * 每个根在侧栏是一棵独立的树。文件身份 = (rootId, path)——两个根里同名的相对路径
 * 不互撞（VS Code multi-root 同款教训）。没有「工作区/Space」外壳：打开几个文件夹
 * 就是几个顶层根，全部常显。
 */
export interface MountRoot {
  id: string
  name: string // 侧栏显示名，默认取路径末段（重名根可改名消歧）
  path: string // 完整挂载路径（demo 无真实文件系统，是假路径）
  origin?: 'local' | 'gdrive' // 来源：本地磁盘 / Google Drive（仅影响侧栏图标）。缺省 local
  // 失联：底层文件夹不可达（被删 / 改名 / 外置盘拔出）。灰显 + 「重新定位 / 移除」，绝不静默丢
  // （下面还挂着标签页 / 折叠状态）。
  missing?: boolean
}

/** The OS app a non-HTML file hands off to, shown in the "open externally" panel.
 *  'html' 和 'md' 都在应用内编辑器打开（不外部），故排除。 */
export const EXTERNAL_APP: Record<Exclude<FileKind, 'html' | 'md'>, string> = {
  word: 'Microsoft Word',
  pdf: '预览',
  image: '预览',
  sheet: 'Numbers',
  slides: 'Keynote',
  other: '默认程序',
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
  kind: 'doc' | 'web' | 'file' // 'file' = a non-HTML file opened from a connected folder
  title: string
  url: string // address-bar string (local path or https url)
  favicon?: string
  fileName?: string // for kind 'file'
  fileKind?: FileKind // for kind 'file'
  rootId?: string // for file tabs: which mount root the file lives in（多根后 url 是根内相对路径,必须配 rootId 才唯一）
  pinned?: boolean // pinned tabs live in 置顶; the rest are transient 标签页
}

/** A file living in a connected folder. Wordspace edits HTML 与 Markdown（同一个块编辑器，
 *  只是后端序列化不同）；其它类型交给系统默认程序。 */
export type FileKind = 'html' | 'md' | 'word' | 'pdf' | 'image' | 'sheet' | 'slides' | 'other'

export interface FileEntry {
  rootId: string // which mount root this file lives under（身份 = (rootId, path)）
  path: string // path under that root, e.g. '品牌/官网首页.html'
  kind: FileKind
  docId?: string // set when kind === 'html' and it maps to an editable doc
}

export interface Toast {
  id: string
  message: string
  tone: 'neutral' | 'success' | 'progress' | 'danger'
  // An optional inline action (e.g. 撤销). Toasts with an action stay longer and
  // become clickable; dismissing or acting clears it.
  action?: { label: string; run: () => void }
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
