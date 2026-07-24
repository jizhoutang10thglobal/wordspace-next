import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AgentEvent,
  Block,
  BlockType,
  ListStyle,
  Doc,
  DocKind,
  FileEntry,
  Folder,
  Member,
  MountRoot,
  Presence,
  Tab,
  Template,
  Toast,
  Visibility,
  Workspace,
} from '../types'
import { useUI } from './ui'
import { t } from '../i18n'
import { rewriteDocsForMoves, invertMoves, dirOf } from '../lib/links'
import {
  ME_ID,
  seedAgentEvents,
  seedDocs,
  seedFiles,
  seedFolders,
  seedMembers,
  seedRoots,
  seedTemplates,
  seedWorkspace,
} from './seed'

// Bump when the shape of seed data changes so a reload reseeds cleanly.
const SEED_VERSION = 28 // 28: 分页压测文档时间散开(默认屏时间流分组演示); 27: 模板加 css/origin 维度 + Doc.templateId/templateCss + 黄金标书模板（用户自定义模板 feature）

// A directory entry under one opened root. 身份 = (rootId, path)。
type DirEntry = { rootId: string; path: string }

const baseOfPath = (p: string) => p.split('/').pop() ?? p

const uid = (p = 'id') =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Strip path separators so a typed name can't silently spawn a directory level,
// and trim. Returns '' when nothing usable is left.
const cleanName = (raw: string): string => raw.replace(/[/\\]/g, '').trim()

// Every directory path that exists under one mount root — both explicit (dirs
// list) and implied by a file's path prefix. Always scoped to a root.
function dirPathsOf(files: FileEntry[], dirs: DirEntry[], rootId: string): Set<string> {
  const set = new Set<string>()
  for (const d of dirs) if (d.rootId === rootId) set.add(d.path)
  for (const f of files)
    if (f.rootId === rootId) {
      const segs = f.path.split('/')
      segs.pop()
      let acc = ''
      for (const s of segs) {
        acc = acc ? `${acc}/${s}` : s
        set.add(acc)
      }
    }
  return set
}

// A collision-free "<dir>/<base><ext>" among one root's files.
function uniqueFileInDir(
  files: FileEntry[],
  rootId: string,
  dir: string,
  base: string,
  ext: string,
): string {
  const taken = new Set(files.filter((f) => f.rootId === rootId).map((f) => f.path))
  const prefix = dir ? `${dir}/` : ''
  let name = `${prefix}${base}${ext}`
  let n = 2
  while (taken.has(name)) {
    name = `${prefix}${base} ${n}${ext}`
    n++
  }
  return name
}

// A collision-free "<parent>/<base>" among one root's directories.
function uniqueDirPath(
  files: FileEntry[],
  dirs: DirEntry[],
  rootId: string,
  parent: string,
  base: string,
): string {
  const taken = dirPathsOf(files, dirs, rootId)
  const prefix = parent ? `${parent}/` : ''
  let name = `${prefix}${base}`
  let n = 2
  while (taken.has(name)) {
    name = `${prefix}${base} ${n}`
    n++
  }
  return name
}

// ---------------------------------------------------------------------------

interface State {
  // data
  workspace: Workspace
  members: Member[]
  folders: Folder[]
  docs: Doc[]
  templates: Template[]
  agentEvents: AgentEvent[]
  roots: MountRoot[] // 侧栏顶层打开的文件夹（顺序 = 显示顺序，持久化）
  files: FileEntry[] // contents of opened folders
  dirs: DirEntry[] // known directories (incl. empty ones), per rootId

  // transient ui (not persisted)
  meId: string
  tabs: Tab[]
  closedTabs: Tab[] // 刚关闭的标签栈，供 ⌘⇧T 重开
  activeTabId: string
  toasts: Toast[]
  presence: Presence[]
  aiBusy: boolean

  // selectors
  getDoc: (id: string) => Doc | undefined
  getMember: (id: string) => Member | undefined

  // tabs
  openDoc: (docId: string) => void
  openWebTab: (url: string, title: string, background?: boolean) => void
  openFileTab: (file: FileEntry) => void
  renameFile: (file: FileEntry, newBase: string) => void
  deleteFileWithUndo: (file: FileEntry) => void
  // opened-folder organize ops (path-based within one root; folders are implicit + the dirs list)
  createSubfolder: (rootId: string, dirPath: string) => void
  renameDir: (rootId: string, dirPath: string, newName: string) => void
  deleteDirWithUndo: (rootId: string, dirPath: string) => void
  moveFile: (file: FileEntry, destDir: string) => void
  newBrowserTab: () => void
  setTabUrl: (tabId: string, url: string, title?: string) => void
  closeTab: (tabId: string) => void
  reopenClosedTab: () => void
  setActiveTab: (tabId: string) => void
  dropTab: (tabId: string, pinned: boolean, toIndex: number) => void
  togglePin: (tabId: string) => void
  // 多文件夹：打开的根就是侧栏顶层，全部常显，没有「工作区/Space」外壳
  addRoot: (path: string) => void // 「添加文件夹」：再打开一个根，和现有的并排
  absorbRoot: (path: string, childRootIds: string[]) => void // 父目录吸收：移除被它包含的子根，加入父根（嵌套裁决）
  removeRoot: (rootId: string) => void // 从侧栏移除（磁盘不动），可撤销
  reorderRoots: (fromRootId: string, toIndex: number) => void // 拖拽调整根的上下顺序（顺序持久化）
  relocateRoot: (rootId: string) => void // 失联根：重新定位到一个可达路径（demo 里 mock 复活）

  // editing
  updateBlockHtml: (docId: string, blockId: string, html: string) => void
  reorderBlocks: (docId: string, from: number, to: number) => void
  addBlock: (
    docId: string,
    afterId: string | null,
    type: BlockType,
    listStyle?: ListStyle,
    html?: string, // 初始内容种子（图片块必传：<img>/<figure> outerHTML）
  ) => string
  deleteBlock: (docId: string, blockId: string) => void
  setBlockType: (
    docId: string,
    blockId: string,
    type: BlockType,
    level?: 1 | 2 | 3 | 4,
    listStyle?: ListStyle,
  ) => void
  duplicateBlock: (docId: string, blockId: string) => string
  // 折叠块展开/收起：只改 block.open + 触脏（updatedAt），刻意不 checkpoint——
  // 折叠是「阅读态」不是内容编辑，绝不占撤销步（对齐真 app KTD5）。
  setBlockOpen: (docId: string, blockId: string, open: boolean) => void

  // 撤销/重做（编辑器历史）。checkpoint 由 Canvas 在每次用户手势前调一次，决定撤销粒度；
  // _past/_future 不在 persist 的 partialize 里（不持久化到 localStorage）。
  checkpoint: () => void
  undo: () => void
  redo: () => void
  _past: Doc[][]
  _future: Doc[][]

  // documents. target (optional) = a {rootId, dir} inside a connected space;
  // ignored for cloud spaces (those land in 我的草稿). 缺省 = 第一个根的根目录。
  createDoc: (folderId: string, kind?: DocKind, title?: string, target?: { rootId: string; dir: string } | null, unsaved?: boolean) => string
  // @提及里选「新建」：在 dir 下静默建一份文档（不切走当前标签页——Notion 同款，链接插完人还在原文档），
  // 返回新文件根内路径。ext 缺省 .html；断链修复的「原地新建」对 .md 断链传 .md（建出来的才接得上）。
  createLinkedDoc: (rootId: string, dir: string, title: string, ext?: '.html' | '.md') => string | null
  createFromTemplate: (templateId: string, folderId: string, target?: { rootId: string; dir: string } | null, unsaved?: boolean) => string
  // 存当前文档为模板（含骨架勾选）：css 取文档已应用模板的快照（从官方好看模板起手→连样子一起存），
  // 素颜文档存出纯骨架。用户模板 origin:'user'。
  saveDocAsTemplate: (docId: string, name: string, includeSkeleton: boolean) => void
  renameTemplate: (id: string, name: string) => void
  deleteTemplateWithUndo: (id: string) => void
  // Cmd+S / 保存：临时文档弹「保存到哪里」modal；已保存的只提示
  saveActiveDoc: () => void
  // 把临时文档保存到指定根的指定文件夹（dir=''=根目录；rootId 空 = 云空间）
  saveDocTo: (docId: string, rootId: string | null, dir: string) => void
  // 丢弃未保存文档（未保存关闭选「不保存」）
  discardDoc: (docId: string) => void
  renameDoc: (docId: string, title: string) => void
  deleteDoc: (docId: string) => void

  // ai (simulated)
  generateDoc: (prompt: string, folderId: string, target?: { rootId: string; dir: string } | null) => Promise<string>
  redesignBlock: (docId: string, blockId: string, prompt: string) => Promise<void>

  // publishing (simulated deploy)
  setVisibility: (docId: string, v: Visibility) => void
  publishDoc: (docId: string, v: Visibility) => Promise<void>
  inviteCollaborator: (docId: string, email: string) => void

  // export (simulated)
  exportDoc: (docId: string, format: 'pdf' | 'docx' | 'pptx') => Promise<void>

  // collaboration presence
  setPresence: (p: Presence[]) => void

  // agents
  addAgentEvent: (e: Omit<AgentEvent, 'id' | 'at'>) => void

  // toasts
  toast: (message: string, tone?: Toast['tone'], action?: Toast['action']) => string
  dismissToast: (id: string) => void
  dismissAllProgress: () => void

  resetAll: () => void
}

// Every directory implied by a file's path, made explicit — so folders are
// first-class: emptying a folder (deleting/moving out its last file) leaves the
// folder standing instead of letting it silently vanish from the tree.
function dirsFromFiles(files: FileEntry[]): DirEntry[] {
  const seen = new Set<string>()
  const out: DirEntry[] = []
  for (const f of files) {
    const segs = f.path.split('/')
    segs.pop()
    let acc = ''
    for (const s of segs) {
      acc = acc ? `${acc}/${s}` : s
      const key = `${f.rootId}::${acc}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ rootId: f.rootId, path: acc })
      }
    }
  }
  return out
}

function freshData() {
  return {
    workspace: { ...seedWorkspace },
    members: seedMembers.map((m) => ({ ...m })),
    folders: seedFolders.map((f) => ({ ...f })),
    docs: seedDocs.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b })) })),
    templates: seedTemplates.map((t) => ({ ...t })),
    agentEvents: seedAgentEvents.map((e) => ({ ...e })),
    roots: seedRoots.map((r) => ({ ...r })),
    files: seedFiles.map((f) => ({ ...f })),
    dirs: dirsFromFiles(seedFiles),
  }
}

// A believable sample of files for a freshly "opened" connected folder — the
// demo has no real filesystem, so picking a folder loads this instead, giving a
// real tree to browse + editable .html docs to open. Folders are registered in
// `dirs` so they persist even when emptied.
function sampleConnectedFolder(
  rootId: string,
  mountPath?: string,
): { docs: Doc[]; files: FileEntry[]; dirs: DirEntry[] } {
  const me = ME_ID
  const now = Date.now()
  const mount = mountPath ?? '~'
  const mkHtml = (path: string, title: string, paras: string[]) => {
    const id = uid('d')
    const blocks: Block[] = [
      { id: uid('b'), type: 'heading', level: 1, html: title },
      ...paras.map((p) => ({ id: uid('b'), type: 'text', html: p }) as Block),
    ]
    const doc: Doc = {
      id,
      title,
      emoji: '📄',
      kind: 'doc',
      folderId: rootId,
      blocks,
      visibility: 'private',
      localPath: `${mount}/${path}`,
      updatedAt: now,
      updatedBy: me,
      collaborators: [me],
    }
    const file: FileEntry = { rootId, path, kind: 'html', docId: id }
    return { doc, file }
  }
  // i18n-exempt-start —— 演示用「连接的文件夹」种子数据（假文件树 + 文档正文），同 mock/seed.ts 类，不翻。
  const home = mkHtml('首页.html', '首页', [
    '这是从你刚选的文件夹里加载进来的本地文档。在 Wordspace 里编辑它,就是在改硬盘上这份 .html 文件。',
    '左边把鼠标移到任意文件夹上,点那个 + 就能在该文件夹里新建一篇并直接打开编辑;右键文件夹还能改名 / 新建子文件夹 / 删除。',
  ])
  const about = mkHtml('关于.html', '关于', ['介绍页示例。随便改两笔试试,保存后就是磁盘上的真文件。'])
  const plan = mkHtml('方案/项目方案.html', '项目方案', [
    '这是子文件夹「方案」里的一篇。把文件拖到别的文件夹可以移动,删掉里面所有文件后文件夹会保留为空文件夹。',
  ])
  const docs = [home.doc, about.doc, plan.doc]
  const files: FileEntry[] = [
    home.file,
    about.file,
    plan.file,
    { rootId, path: '方案/报价单.pdf', kind: 'pdf' },
    { rootId, path: '素材/封面.png', kind: 'image' },
    { rootId, path: '素材/Logo.png', kind: 'image' },
    { rootId, path: '文档/会议纪要.docx', kind: 'word' },
  ]
  const dirs: DirEntry[] = ['方案', '素材', '文档'].map((p) => ({ rootId, path: p }))
  // i18n-exempt-end
  return { docs, files, dirs }
}

// 根显示名：取路径末段（'~/Projects/品牌升级' → '品牌升级'）。
const rootNameOf = (path: string): string => {
  const segs = path.split('/').filter(Boolean)
  return segs[segs.length - 1] ?? path
}

// 段落内联 html ↔ 列表 html 的形态转换（转块时保内容）：转成列表把内容包成单个 <li>；
// 离开列表把各 <li> 拆开用 <br> 连接。两个函数都幂等（已是目标形态则原样返回）。
const toListHtml = (html: string): string =>
  /<li[\s>]/i.test(html) ? html : `<li>${html.trim()}</li>`
const fromListHtml = (html: string): string => {
  const items = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi)
  return items
    ? items.map((li) => li.replace(/<\/?li[^>]*>/gi, '')).join('<br>')
    : html.replace(/<\/?li[^>]*>/gi, '')
}

// 段落 ↔ 折叠 的形态转换（转块保内容，对称 to/from-List）：
// 转折叠 = 现内容塞进 summary + 一个空 body <p>；离开折叠 = summary 文本在前、body 各块摊平，
// 块边界转 <br>、保留行内标记（<strong>/<a> 等）。open 由 setBlockType 单独置（不进 html）。
const toToggleHtml = (html: string): string =>
  `<details><summary>${html.trim()}</summary></details>` // 空 body → ToggleBlockView 显示占位符
const fromToggleHtml = (html: string): string => {
  const summary = (html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? '').trim()
  const body = html
    .replace(/^[\s\S]*?<\/summary>/i, '') // 丢掉 <details…><summary…>…</summary>
    .replace(/<\/details>\s*$/i, '')
    .replace(/<(p|div|h[1-6]|blockquote|li)\b[^>]*>/gi, '') // 去块级开标签
    .replace(/<\/(p|div|h[1-6]|blockquote|li)>/gi, '<br>') // 块级闭标签 → 换行
    .replace(/<\/?(ul|ol|details)\b[^>]*>/gi, '') // 列表/details 容器标签直接去
    .replace(/(\s*<br>\s*)+$/i, '') // 收尾多余 <br>
    .trim()
  return [summary, body].filter(Boolean).join('<br>')
}

// 撤销历史用的 docs 深拷贝（只拷到 blocks 这层，够本 mock 用）。
const cloneDocs = (docs: Doc[]): Doc[] =>
  docs.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b })) }))

// 斜杠菜单新插入的表格/代码块的默认内容。表格用内联样式（与 embed 表格同形状，
// 单元格可直接 contentEditable）；代码用 <div class="ws-code-line"> 按行元素（Phase 2 可对行加 margin 推挤）。
const TD = 'border:1px solid #e4e6e9;padding:6px 10px;'
const TH = TD + 'background:#f5f5f4;text-align:left;'
// 默认表格：单元格占位文案按当前语言生成（新建时求值，故用函数而非 const，否则模块 init 时冻结语言）。
const defaultTableHtml = (): string =>
  `<table style="border-collapse:collapse;width:100%;font-size:14px;">` +
  `<thead><tr><th style="${TH}">${t('editor.tableColumn', { n: 1 })}</th><th style="${TH}">${t('editor.tableColumn', { n: 2 })}</th></tr></thead>` +
  `<tbody>` +
  `<tr><td style="${TD}">${t('editor.tableCell')}</td><td style="${TD}">${t('editor.tableCell')}</td></tr>` +
  `<tr><td style="${TD}">${t('editor.tableCell')}</td><td style="${TD}">${t('editor.tableCell')}</td></tr>` +
  `</tbody></table>`
const DEFAULT_CODE_HTML =
  `<div class="ws-code-line">function hello() {</div>` +
  `<div class="ws-code-line">  return 'world'</div>` +
  `<div class="ws-code-line">}</div>`
// 折叠块种子种**空**——summary/body 的占位灰字由 ToggleBlockView 的 data-placeholder（:empty::before）
// 显示。种 i18n 文案会让占位变真文本、用户打字接在「Toggle heading」后面还得手删（真 app
// U9/create-2 同款教训「种空产物、不种 i18n 占位文本」；Wendi 试手感首要动作就是建块打字）。
// 展开态不写进 html 的 open 属性——open 由 block.open 单独持有（setBlockOpen 改它、不改 html），
// 避免两处 open 漂移；打印导出（printExport）再强制展开。
const DEFAULT_TOGGLE_HTML = (): string => `<details><summary></summary></details>`
// ↑ body 也真空：ToggleBlockView 的 body 区是独立 contentEditable，种 <p></p> 会让 :empty 不成立、
//   「Toggle body」灰字占位永不显示（截图实测）；真空时 min-height:1.5em 仍可点、落笔即写。

const newBlock = (type: BlockType, listStyle?: ListStyle): Block => {
  const base: Record<BlockType, Partial<Block>> = {
    heading: { level: 2, html: t('editor.newHeading') },
    text: { html: '' },
    list: { html: `<li>${t('editor.newListItem')}</li>` },
    quote: { html: t('editor.newQuote') },
    image: { html: '' }, // 图片块永远带 html 种子创建（imageBlockHtml），空串只是防御缺省
    divider: { html: '' },
    callout: { html: t('editor.newCallout') },
    embed: { html: '' },
    table: { html: defaultTableHtml() },
    code: { html: DEFAULT_CODE_HTML },
    toggle: { html: DEFAULT_TOGGLE_HTML(), open: true },
  }
  const block = { id: uid('b'), type, ...base[type] } as Block
  if (type === 'list') block.listStyle = listStyle ?? 'bulleted'
  return block
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...freshData(),
      _past: [],
      _future: [],

      meId: ME_ID,
      // 标签页是全局单一集合（不再按空间分组）：置顶组 + 普通组，全部同时可见。
      // i18n-exempt-start —— 开局种子标签页（演示文档/网页标题），演示数据不翻。
      tabs: [
        // 置顶 (pinned)
        { id: 'tab-1', docId: 'd-handbook', kind: 'doc', pinned: true, title: '员工手册', url: 'https://team.tenthglobal.com/handbook' },
        { id: 'tab-tg', kind: 'web', pinned: true, title: 'Tenth Global', url: 'https://tenthglobal.com' },
        { id: 'tab-flow', kind: 'web', pinned: true, title: 'FlowDesk', url: 'https://flowdesk.app' },
        // 标签页 (transient)
        { id: 'tab-web', kind: 'web', title: 'Designer News · 行业动态', url: 'https://news.design/today' },
        // 开局落在互链演示文档上（含「怎么创建链接」教学块）——落地页.html 几乎全是 designed 装饰块，
        // 不可编辑，用户在上面试 @/工具栏/拖拽会全体没反应（Colin 实测）
        { id: 'tab-local', kind: 'doc', docId: 'd-r2-plan', title: '产品规划.html', url: '产品规划.html', fileName: '产品规划.html', fileKind: 'html', rootId: 'r-docs' },
      ],
      // i18n-exempt-end
      activeTabId: 'tab-local',
      closedTabs: [],
      toasts: [],
      presence: [],
      aiBusy: false,

      getDoc: (id) => get().docs.find((d) => d.id === id),
      getMember: (id) => get().members.find((m) => m.id === id),

      openDoc: (docId) => {
        const doc = get().getDoc(docId)
        if (!doc) return
        const existing = get().tabs.find((t) => t.docId === docId && !t.fileName)
        if (existing) {
          set({ activeTabId: existing.id })
          return
        }
        const tab: Tab = {
          id: uid('tab'),
          docId,
          kind: 'doc',
          title: doc.title,
          url: doc.publishedUrl ?? doc.localPath,
        }
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      },

      openWebTab: (url, title, background) => {
        const tab: Tab = { id: uid('tab'), kind: 'web', title, url }
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: background ? s.activeTabId : tab.id }))
      },

      // Open a file from a connected folder. HTML opens in the editor (a 'doc'
      // tab linked to its doc, but labeled with the file name); every other type
      // opens the "not HTML, open externally" panel. A file already open in the
      // space is reused, not duplicated.
      openFileTab: (file) => {
        const existing = get().tabs.find(
          (t) => !!t.fileName && t.rootId === file.rootId && t.url === file.path,
        )
        if (existing) {
          set({ activeTabId: existing.id })
          return
        }
        const name = file.path.split('/').pop() ?? file.path
        // html 和 md 都进块编辑器（同一个前端 UI，只是后端序列化不同）；其余走外部打开。
        const editable = (file.kind === 'html' || file.kind === 'md') && !!file.docId
        const tab: Tab = {
          id: uid('tab'),
          kind: editable ? 'doc' : 'file',
          docId: editable ? file.docId : undefined,
          title: name,
          url: file.path,
          fileName: name,
          fileKind: file.kind,
          rootId: file.rootId,
        }
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      },

      // Rename a file in a connected folder: keep its folder path and extension,
      // change the leaf name; the open tab and (for HTML) the file's tab label
      // follow.
      renameFile: (file, newBase) => {
        const base = cleanName(newBase) // strip '/' so a rename can't move the file
        if (!base) return
        const slash = file.path.lastIndexOf('/')
        const dir = slash >= 0 ? file.path.slice(0, slash) : ''
        const dot = file.path.lastIndexOf('.')
        const ext = dot > slash ? file.path.slice(dot) : ''
        if (`${dir ? dir + '/' : ''}${base}${ext}` === file.path) return
        // dedupe against same-root siblings (excluding this file), like the create flow does
        const others = get().files.filter(
          (f) => !(f.rootId === file.rootId && f.path === file.path),
        )
        const newPath = uniqueFileInDir(others, file.rootId, dir, base, ext)
        const newName = newPath.split('/').pop() ?? newPath
        // 互链：改名前先算「谁的链接指向旧路径」→ 一并重写（真 app「改名自动重写引用」同款；toast 可撤销）
        const pre = get()
        const moved = new Map([[file.path, newPath]])
        const rewrite = rewriteDocsForMoves(pre.docs, pre.files, file.rootId, moved)
        set((s) => ({
          files: s.files.map((f) =>
            f.rootId === file.rootId && f.path === file.path ? { ...f, path: newPath } : f,
          ),
          tabs: s.tabs.map((t) =>
            t.fileName && t.rootId === file.rootId && t.url === file.path
              ? { ...t, url: newPath, fileName: newName, title: newName }
              : t,
          ),
          docs: rewrite.changed.length ? rewrite.docs : s.docs,
        }))
        if (rewrite.changed.length) {
          get().toast(t('sidebar.linksUpdated', { count: rewrite.changed.length }), 'success', {
            label: t('common.undo'),
            // 撤销 = 名字改回 + **反向再重写一遍**（只动 href，不回滚用户内容——存 blocks 快照整体
            // 回滚会把撤销窗口内用户的编辑一起吞掉，对抗审查抓到的坑）。执行前校验前提：文件还在
            // 新路径、旧路径没被占——否则已被后续操作覆盖，放弃并明说，不做半套撤销。
            run: () => {
              const s = get()
              const still = s.files.some((f) => f.rootId === file.rootId && f.path === newPath)
              const occupied = s.files.some((f) => f.rootId === file.rootId && f.path === file.path)
              if (!still || occupied) {
                s.toast(t('sidebar.undoRenameFailed'), 'neutral')
                return
              }
              const back = rewriteDocsForMoves(s.docs, s.files, file.rootId, invertMoves(moved))
              set((st) => ({
                files: st.files.map((f) =>
                  f.rootId === file.rootId && f.path === newPath ? { ...f, path: file.path } : f,
                ),
                tabs: st.tabs.map((t) =>
                  t.fileName && t.rootId === file.rootId && t.url === newPath
                    ? { ...t, url: file.path, fileName: baseOfPath(file.path), title: baseOfPath(file.path) }
                    : t,
                ),
                docs: back.docs,
              }))
            },
          })
        }
      },

      // Delete a file but keep it recoverable: snapshot what we remove, then show
      // a toast with 撤销 that puts it back. Guard against the cross-file cascade —
      // only drop the backing doc if NO other file (in any space) still points at
      // it, so deleting one .html never silently destroys another file's content.
      deleteFileWithUndo: (file) => {
        const s = get()
        const prevActiveTabId = s.activeTabId
        const sameEntry = (f: FileEntry) => f.rootId === file.rootId && f.path === file.path
        const sharedByOther = s.files.some(
          (f) => f.docId && f.docId === file.docId && !sameEntry(f),
        )
        const cloudFolderIds = new Set(s.folders.map((f) => f.id))
        const candidate =
          file.docId && !sharedByOther ? s.docs.find((d) => d.id === file.docId) : undefined
        // 云盘文档有独立身份（云盘归属 / 发布 / 置顶），删连接文件只解除映射，绝不销毁它。
        const removedDoc = candidate && !cloudFolderIds.has(candidate.folderId) ? candidate : undefined
        const removedTabs = s.tabs.filter(
          (t) => t.fileName && t.rootId === file.rootId && t.url === file.path,
        )
        const removedTabIds = new Set(removedTabs.map((t) => t.id))
        set((st) => {
          const files = st.files.filter((f) => !sameEntry(f))
          const docs = removedDoc ? st.docs.filter((d) => d.id !== removedDoc.id) : st.docs
          const tabs = st.tabs.filter((t) => !removedTabIds.has(t.id))
          let activeTabId = st.activeTabId
          if (removedTabIds.has(st.activeTabId)) activeTabId = tabs[tabs.length - 1]?.id ?? ''
          return { files, docs, tabs, activeTabId }
        })
        const name = file.path.split('/').pop() ?? file.path
        get().toast(t('sidebar.deletedName', { name }), 'neutral', {
          label: t('common.undo'),
          run: () =>
            set((st) => ({
              files: [...st.files, file],
              docs: removedDoc ? [removedDoc, ...st.docs] : st.docs,
              tabs: [...st.tabs, ...removedTabs],
              // re-focus the restored file, so 撤销 truly returns to pre-delete state
              activeTabId: prevActiveTabId,
            })),
        })
      },

      // Create an (initially empty) subfolder under `dirPath` in one root. Empty
      // folders are tracked in `dirs` so the tree can show them before they hold any file.
      createSubfolder: (rootId, dirPath) => {
        const root = get().roots.find((r) => r.id === rootId)
        if (!root || root.missing) return
        const path = uniqueDirPath(get().files, get().dirs, rootId, dirPath, t('sidebar.newFolder'))
        set((s) => ({ dirs: [...s.dirs, { rootId, path }] }))
      },

      // Rename a directory: rewrite the path prefix of every file, sub-dir, and
      // open tab living under it (all scoped to the dir's root). Sanitized +
      // deduped against sibling dirs.
      renameDir: (rootId, dirPath, newName) => {
        const root = get().roots.find((r) => r.id === rootId)
        if (!root || root.missing) return
        const clean = cleanName(newName)
        if (!clean) return
        const segs = dirPath.split('/')
        segs.pop()
        const parent = segs.join('/')
        const base = parent ? `${parent}/` : ''
        const naive = `${base}${clean}`
        if (naive === dirPath) return
        const oldPrefix = `${dirPath}/`
        const taken = dirPathsOf(get().files, get().dirs, rootId)
        for (const p of [...taken]) if (p === dirPath || p.startsWith(oldPrefix)) taken.delete(p)
        let target = naive
        let n = 2
        while (taken.has(target)) {
          target = `${base}${clean} ${n}`
          n++
        }
        const remap = (p: string) =>
          p === dirPath
            ? target
            : p.startsWith(oldPrefix)
              ? `${target}/${p.slice(oldPrefix.length)}`
              : p
        // 互链：子树整体换前缀 → moved 映射给全部受影响文件。子树**内部**互链（旧解析+新重算抵消）天然不变，
        // 只有「树外 ↔ 树内」的链接会真的被改写。
        const pre = get()
        const movedMap = new Map<string, string>()
        for (const f of pre.files) {
          if (f.rootId === rootId && remap(f.path) !== f.path) movedMap.set(f.path, remap(f.path))
        }
        const rewrite = rewriteDocsForMoves(pre.docs, pre.files, rootId, movedMap)
        set((s) => ({
          files: s.files.map((f) => (f.rootId === rootId ? { ...f, path: remap(f.path) } : f)),
          dirs: s.dirs.map((d) => (d.rootId === rootId ? { ...d, path: remap(d.path) } : d)),
          tabs: s.tabs.map((t) =>
            t.fileName && t.rootId === rootId && t.url ? { ...t, url: remap(t.url) } : t,
          ),
          docs: rewrite.changed.length ? rewrite.docs : s.docs,
        }))
        if (rewrite.changed.length) {
          // 文件夹改名本身没有撤销（与现状一致），这里只告知链接已跟上
          get().toast(t('sidebar.linksUpdated', { count: rewrite.changed.length }), 'success')
        }
      },

      // Delete a directory and everything under it, recoverably. Same backing-doc
      // guard as deleteFileWithUndo: a doc is dropped only if no surviving file
      // still references it.
      deleteDirWithUndo: (rootId, dirPath) => {
        const s = get()
        const prevActiveTabId = s.activeTabId
        const prefix = `${dirPath}/`
        const inRoot = (x: { rootId?: string }) => x.rootId === rootId
        const removedFiles = s.files.filter(
          (f) => inRoot(f) && (f.path === dirPath || f.path.startsWith(prefix)),
        )
        const removedKeys = new Set(removedFiles.map((f) => f.path))
        const removedDirs = s.dirs.filter(
          (d) => inRoot(d) && (d.path === dirPath || d.path.startsWith(prefix)),
        )
        if (!removedFiles.length && !removedDirs.length) return
        const survivingFiles = s.files.filter((f) => !(inRoot(f) && removedKeys.has(f.path)))
        const cloudFolderIds = new Set(s.folders.map((f) => f.id))
        const removedDocs = s.docs.filter(
          (d) =>
            removedFiles.some((f) => f.docId === d.id) &&
            !survivingFiles.some((sf) => sf.docId === d.id) &&
            !cloudFolderIds.has(d.folderId), // 云盘文档不随连接文件夹删除而销毁
        )
        const removedTabs = s.tabs.filter(
          (t) => t.fileName && inRoot(t) && removedKeys.has(t.url),
        )
        const removedTabIds = new Set(removedTabs.map((t) => t.id))
        set((st) => {
          const files = st.files.filter((f) => !(inRoot(f) && removedKeys.has(f.path)))
          const dirs = st.dirs.filter(
            (d) => !(inRoot(d) && (d.path === dirPath || d.path.startsWith(prefix))),
          )
          const docs = removedDocs.length
            ? st.docs.filter((d) => !removedDocs.some((rd) => rd.id === d.id))
            : st.docs
          const tabs = st.tabs.filter((t) => !removedTabIds.has(t.id))
          let activeTabId = st.activeTabId
          if (removedTabIds.has(st.activeTabId)) activeTabId = tabs[tabs.length - 1]?.id ?? ''
          return { files, dirs, docs, tabs, activeTabId }
        })
        const leaf = dirPath.split('/').pop() ?? dirPath
        const cnt = removedFiles.length
        get().toast(
          cnt ? t('sidebar.folderDeletedWithCount', { name: leaf, count: cnt }) : t('sidebar.folderDeleted', { name: leaf }),
          'neutral',
          {
            label: t('common.undo'),
            run: () =>
              set((st) => ({
                files: [...st.files, ...removedFiles],
                dirs: [...st.dirs, ...removedDirs],
                docs: removedDocs.length ? [...removedDocs, ...st.docs] : st.docs,
                tabs: [...st.tabs, ...removedTabs],
                activeTabId: prevActiveTabId,
              })),
          },
        )
      },

      // Move a file into `destDir` (relative to its own root; '' = root) by
      // rewriting its path prefix, deduping the leaf against whatever already
      // lives there. 跨根移动在 UI 层就禁掉（真实后端是跨设备 EXDEV 语义,另立项）。
      moveFile: (file, destDir) => {
        const leaf = file.path.split('/').pop() ?? file.path
        const dot = leaf.lastIndexOf('.')
        const base = dot > 0 ? leaf.slice(0, dot) : leaf
        const ext = dot > 0 ? leaf.slice(dot) : ''
        const others = get().files.filter(
          (f) => !(f.rootId === file.rootId && f.path === file.path),
        )
        const newPath = uniqueFileInDir(others, file.rootId, destDir, base, ext)
        if (newPath === file.path) return // dropped onto its own folder — no-op
        // 互链：移动 = 指向它的链接要改 + **它自己的出链要按新位置 rebase**（Obsidian 的著名缺口就漏了后半）
        const pre = get()
        const moved = new Map([[file.path, newPath]])
        const rewrite = rewriteDocsForMoves(pre.docs, pre.files, file.rootId, moved)
        set((s) => ({
          files: s.files.map((f) =>
            f.rootId === file.rootId && f.path === file.path ? { ...f, path: newPath } : f,
          ),
          tabs: s.tabs.map((t) =>
            t.fileName && t.rootId === file.rootId && t.url === file.path
              ? { ...t, url: newPath }
              : t,
          ),
          docs: rewrite.changed.length ? rewrite.docs : s.docs,
        }))
        // 撤销 = 移回去 + 反向重写（与 renameFile 同一套语义——同一个承诺同一种兑现）
        get().toast(
          t('sidebar.movedTo', { name: leaf, dest: destDir || t('sidebar.rootDir') }) +
            (rewrite.changed.length ? t('sidebar.movedLinksSuffix', { count: rewrite.changed.length }) : ''),
          'neutral',
          {
            label: t('common.undo'),
            run: () => {
              const s = get()
              const still = s.files.some((f) => f.rootId === file.rootId && f.path === newPath)
              const occupied = s.files.some((f) => f.rootId === file.rootId && f.path === file.path)
              if (!still || occupied) {
                s.toast(t('sidebar.undoMoveFailed'), 'neutral')
                return
              }
              const back = rewriteDocsForMoves(s.docs, s.files, file.rootId, invertMoves(moved))
              set((st) => ({
                files: st.files.map((f) =>
                  f.rootId === file.rootId && f.path === newPath ? { ...f, path: file.path } : f,
                ),
                tabs: st.tabs.map((t) =>
                  t.fileName && t.rootId === file.rootId && t.url === newPath ? { ...t, url: file.path } : t,
                ),
                docs: back.docs,
              }))
            },
          },
        )
      },

      newBrowserTab: () => {
        const tab: Tab = { id: uid('tab'), kind: 'web', title: t('sidebar.newTabTitle'), url: '' }
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      },

      setTabUrl: (tabId, url, title) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, url, title: title ?? t.title } : t,
          ),
        })),

      // 「添加文件夹」：再打开一个根（VS Code "Add Folder to Workspace" 语义）。
      // demo 无真实文件系统 → 新根载入示例树。根显示名取路径末段。追加到 roots 末尾。
      addRoot: (path) => {
        const root: MountRoot = { id: uid('r'), name: rootNameOf(path), path, origin: 'local' }
        const sample = sampleConnectedFolder(root.id, path)
        set((s) => ({
          roots: [...s.roots, root],
          docs: [...sample.docs, ...s.docs],
          files: [...s.files, ...sample.files],
          dirs: [...s.dirs, ...sample.dirs],
        }))
        get().toast(t('sidebar.folderOpened', { name: root.name }), 'success')
      },

      // 父目录吸收（嵌套裁决：打开一个「包住了已打开子根」的父目录时，把子根并入父根，避免同一批文件两次出现）。
      // 移除被包含的子根的文件/目录（磁盘不动，纯 UI），再把父根加进来。
      absorbRoot: (path, childRootIds) => {
        const drop = new Set(childRootIds)
        const root: MountRoot = { id: uid('r'), name: rootNameOf(path), path, origin: 'local' }
        const sample = sampleConnectedFolder(root.id, path)
        set((s) => {
          const cloudFolderIds = new Set(s.folders.map((f) => f.id))
          // 只有「没有存活文件仍引用、且不是云盘文档」的子根文档才真正丢弃——
          // 否则会误删还被别的根（如 Google Drive 根）或云盘小区引用的共享文档。
          const survivorDocIds = new Set(
            s.files.filter((f) => !drop.has(f.rootId)).map((f) => f.docId).filter(Boolean),
          )
          const dropDocIds = new Set(
            s.files
              .filter((f) => drop.has(f.rootId) && f.docId && !survivorDocIds.has(f.docId))
              .map((f) => f.docId!)
              .filter((id) => {
                const d = s.docs.find((x) => x.id === id)
                return !!d && !cloudFolderIds.has(d.folderId)
              }),
          )
          // 关掉：指向被丢弃文档的标签页 + 落在被吸收子根里的文件标签页（那些文件已不在）。
          const tabs = s.tabs.filter(
            (t) => !(t.rootId && drop.has(t.rootId)) && !(t.docId && dropDocIds.has(t.docId)),
          )
          let activeTabId = s.activeTabId
          if (!tabs.some((t) => t.id === activeTabId)) activeTabId = tabs[tabs.length - 1]?.id ?? ''
          return {
            // 子根从 roots 里去掉，父根追加到末尾
            roots: [...s.roots.filter((r) => !drop.has(r.id)), root],
            docs: [...sample.docs, ...s.docs.filter((d) => !dropDocIds.has(d.id))],
            files: [...s.files.filter((f) => !drop.has(f.rootId)), ...sample.files],
            dirs: [...s.dirs.filter((d) => !drop.has(d.rootId)), ...sample.dirs],
            tabs,
            activeTabId,
          }
        })
        get().toast(t('sidebar.folderAbsorbed', { name: root.name }), 'success')
      },

      // 从侧栏移除一个根：文件/目录/标签页整组撤走，磁盘文件不动（remove ≠ delete）。
      // 快照被移走的一切，toast 提供撤销。
      removeRoot: (rootId) => {
        const s = get()
        const root = s.roots.find((r) => r.id === rootId)
        if (!root) return
        const rootIdx = s.roots.findIndex((r) => r.id === rootId)
        const prevActiveTabId = s.activeTabId
        const removedFiles = s.files.filter((f) => f.rootId === rootId)
        const removedDirs = s.dirs.filter((d) => d.rootId === rootId)
        const removedTabs = s.tabs.filter((t) => t.fileName && t.rootId === rootId)
        const removedTabIds = new Set(removedTabs.map((t) => t.id))
        // 该根独占的文档（没有其他根的文件仍指向它的）跟着撤走——撤销时一并还原。
        const survivorDocIds = new Set(
          s.files.filter((f) => f.rootId !== rootId).map((f) => f.docId).filter(Boolean),
        )
        const cloudFolderIds = new Set(s.folders.map((f) => f.id))
        const removedDocs = s.docs.filter(
          (d) =>
            removedFiles.some((f) => f.docId === d.id) &&
            !survivorDocIds.has(d.id) &&
            !cloudFolderIds.has(d.folderId), // 云盘文档不随连接根移除而销毁
        )
        const removedDocIds = new Set(removedDocs.map((d) => d.id))
        set((st) => {
          const tabs = st.tabs.filter((t) => !removedTabIds.has(t.id))
          let activeTabId = st.activeTabId
          if (removedTabIds.has(st.activeTabId)) activeTabId = tabs[tabs.length - 1]?.id ?? ''
          return {
            roots: st.roots.filter((r) => r.id !== rootId),
            files: st.files.filter((f) => f.rootId !== rootId),
            dirs: st.dirs.filter((d) => d.rootId !== rootId),
            docs: st.docs.filter((d) => !removedDocIds.has(d.id)),
            tabs,
            activeTabId,
          }
        })
        get().toast(t('sidebar.rootRemoved', { name: root.name }), 'neutral', {
          label: t('common.undo'),
          run: () =>
            set((st) => {
              const roots = [...st.roots]
              roots.splice(Math.min(rootIdx, roots.length), 0, root) // 放回原来的位置
              return {
                roots,
                files: [...st.files, ...removedFiles],
                dirs: [...st.dirs, ...removedDirs],
                docs: [...removedDocs, ...st.docs],
                tabs: [...st.tabs, ...removedTabs],
                activeTabId: prevActiveTabId,
              }
            }),
        })
      },

      // 拖拽重排根：把 fromRootId 挪到 toIndex（以「移除它之后的数组」为基准的插入位）。顺序持久化。
      reorderRoots: (fromRootId, toIndex) =>
        set((s) => {
          const moving = s.roots.find((r) => r.id === fromRootId)
          if (!moving) return s
          const rest = s.roots.filter((r) => r.id !== fromRootId)
          rest.splice(Math.max(0, Math.min(toIndex, rest.length)), 0, moving)
          return { roots: rest }
        }),

      // 失联根重新定位：demo 里把它标回可达（mock 复活）+ 载入示例树（原来失联时没有内容）。
      relocateRoot: (rootId) => {
        const root = get().roots.find((r) => r.id === rootId)
        if (!root || !root.missing) return
        const hasContent = get().files.some((f) => f.rootId === rootId)
        const sample = hasContent ? null : sampleConnectedFolder(rootId, root.path)
        set((s) => ({
          roots: s.roots.map((r) => (r.id === rootId ? { ...r, missing: false } : r)),
          docs: sample ? [...sample.docs, ...s.docs] : s.docs,
          files: sample ? [...s.files, ...sample.files] : s.files,
          dirs: sample ? [...s.dirs, ...sample.dirs] : s.dirs,
        }))
        get().toast(t('sidebar.rootReconnected', { name: root.name }), 'success')
      },

      closeTab: (tabId) =>
        set((s) => {
          const closing = s.tabs.find((t) => t.id === tabId)
          const tabs = s.tabs.filter((t) => t.id !== tabId)
          let activeTabId = s.activeTabId
          if (s.activeTabId === tabId) {
            // 继任只在普通标签里找——置顶是「钉住」不是「打开」,不自动接管激活;
            // 普通标签关光了就回导览页(空态),与真 app 语义一致(Colin 2026-07-17 实测抓出)。
            const unpinned = tabs.filter((t) => !t.pinned)
            activeTabId = unpinned[unpinned.length - 1]?.id ?? ''
          }
          // 记进「刚关闭」栈，供 ⌘⇧T 重开（临时未保存文档不记，重开也没内容）
          const closedTabs = closing && !closing.docId ? [closing, ...s.closedTabs].slice(0, 15) : s.closedTabs
          return { tabs, activeTabId, closedTabs }
        }),

      reopenClosedTab: () =>
        set((s) => {
          const [last, ...rest] = s.closedTabs
          if (!last) return {}
          const tab: Tab = { ...last, id: uid('tab') }
          return { tabs: [...s.tabs, tab], activeTabId: tab.id, closedTabs: rest }
        }),

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      // Drop a dragged tab into a (pinned?) group at a position: this both sets its
      // pinned state (so a tab moves between 标签页 and 置顶) and reorders it within
      // that group.
      dropTab: (tabId, pinned, toIndex) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId)
          if (!tab) return s
          const moved = { ...tab, pinned }
          const inGroup = s.tabs.filter((t) => t.id !== tabId && !!t.pinned === pinned)
          const others = s.tabs.filter((t) => t.id !== tabId && !!t.pinned !== pinned)
          inGroup.splice(Math.max(0, Math.min(toIndex, inGroup.length)), 0, moved)
          return { tabs: [...others, ...inGroup] }
        }),

      togglePin: (tabId) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)),
        })),

      updateBlockHtml: (docId, blockId, html) =>
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id !== docId
              ? d
              : {
                  ...d,
                  updatedAt: Date.now(),
                  updatedBy: s.meId,
                  blocks: d.blocks.map((b) =>
                    b.id === blockId ? { ...b, html } : b,
                  ),
                },
          ),
        })),

      reorderBlocks: (docId, from, to) =>
        set((s) => ({
          docs: s.docs.map((d) => {
            if (d.id !== docId) return d
            const blocks = [...d.blocks]
            const [moved] = blocks.splice(from, 1)
            blocks.splice(to, 0, moved)
            return { ...d, blocks, updatedAt: Date.now(), updatedBy: s.meId }
          }),
        })),

      addBlock: (docId, afterId, type, listStyle, html) => {
        const block = newBlock(type, listStyle)
        if (html !== undefined) block.html = html
        set((s) => ({
          docs: s.docs.map((d) => {
            if (d.id !== docId) return d
            const blocks = [...d.blocks]
            const idx = afterId
              ? blocks.findIndex((b) => b.id === afterId) + 1
              : blocks.length
            blocks.splice(idx, 0, block)
            return { ...d, blocks, updatedAt: Date.now(), updatedBy: s.meId }
          }),
        }))
        return block.id
      },

      deleteBlock: (docId, blockId) =>
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id !== docId
              ? d
              : { ...d, blocks: d.blocks.filter((b) => b.id !== blockId) },
          ),
        })),

      // 转块类型（Notion 的「转为…」/heyhtml 的块类型切换）。进 heading 给默认 level，
      // 离开 heading 清掉 level；html（文字内容）保留。
      setBlockType: (docId, blockId, type, level, listStyle) =>
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id !== docId
              ? d
              : {
                  ...d,
                  updatedAt: Date.now(),
                  updatedBy: s.meId,
                  blocks: d.blocks.map((b) => {
                    if (b.id !== blockId) return b
                    const wasList = b.type === 'list'
                    const willList = type === 'list'
                    const wasToggle = b.type === 'toggle'
                    const willToggle = type === 'toggle'
                    // 先把源内容摊平成行内 html（离开列表拆 <li>、离开折叠取 summary+body），
                    // 再按目标形态包装（进列表包 <li>、进折叠包 <summary>+空 body）。
                    let content = b.html
                    if (wasList && !willList) content = fromListHtml(b.html)
                    else if (wasToggle && !willToggle) content = fromToggleHtml(b.html)
                    let html = content
                    if (willToggle && !wasToggle) html = toToggleHtml(content)
                    else if (willList && !wasList) html = toListHtml(content)
                    return {
                      ...b,
                      type,
                      html,
                      level:
                        type === 'heading' ? level ?? b.level ?? 2 : undefined,
                      listStyle: willList
                        ? listStyle ?? b.listStyle ?? 'bulleted'
                        : undefined,
                      // 进折叠给默认展开；离开折叠清掉 open（否则残留脏字段）
                      open: willToggle ? b.open ?? true : undefined,
                    }
                  }),
                },
          ),
        })),

      // 折叠块展开/收起：只翻 block.open + 触脏，不 checkpoint（折叠不进撤销史）。
      setBlockOpen: (docId, blockId, open) =>
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id !== docId
              ? d
              : {
                  ...d,
                  updatedAt: Date.now(),
                  updatedBy: s.meId,
                  blocks: d.blocks.map((b) =>
                    b.id === blockId ? { ...b, open } : b,
                  ),
                },
          ),
        })),

      // 复制块：克隆并插到原块之后，给新 id，返回它。
      duplicateBlock: (docId, blockId) => {
        const newId = uid('b')
        set((s) => ({
          docs: s.docs.map((d) => {
            if (d.id !== docId) return d
            const idx = d.blocks.findIndex((b) => b.id === blockId)
            if (idx < 0) return d
            const blocks = [...d.blocks]
            blocks.splice(idx + 1, 0, { ...blocks[idx], id: newId })
            return { ...d, blocks, updatedAt: Date.now(), updatedBy: s.meId }
          }),
        }))
        return newId
      },

      // 在一次用户手势前快照当前 docs（清空 redo 栈）。复合操作只在入口调一次 → 一次撤销回到手势前。
      checkpoint: () =>
        set((s) => ({ _past: [...s._past, cloneDocs(s.docs)].slice(-50), _future: [] })),
      undo: () =>
        set((s) => {
          if (!s._past.length) return {}
          return {
            docs: s._past[s._past.length - 1],
            _past: s._past.slice(0, -1),
            _future: [...s._future, cloneDocs(s.docs)],
          }
        }),
      redo: () =>
        set((s) => {
          if (!s._future.length) return {}
          return {
            docs: s._future[s._future.length - 1],
            _future: s._future.slice(0, -1),
            _past: [...s._past, cloneDocs(s.docs)],
          }
        }),

      createDoc: (folderId, kind = 'doc', title = t('sidebar.untitledDoc'), target, unsaved = false) => {
        const id = uid('d')
        // 目标根 = target 指定的根（且非失联）；没有则落云盘（folderId=我的草稿）。
        const root = target?.rootId ? get().roots.find((r) => r.id === target.rootId && !r.missing) : undefined
        const inFolder = !!root
        const dir = target?.dir ?? ''
        const fileName = inFolder
          ? uniqueFileInDir(get().files, root!.id, dir, title, '.html')
          : `${title}.html`
        const doc: Doc = {
          id,
          title,
          emoji: kind === 'page' ? '🗒️' : kind === 'slides' ? '📊' : '📄',
          kind,
          folderId: inFolder ? root!.id : folderId,
          blocks: [{ id: uid('b'), type: 'heading', level: 1, html: title }],
          visibility: 'private',
          localPath: inFolder
            ? `${root!.path}/${fileName}`
            : `~/Wordspace/我的草稿/${title}.html`, // i18n-exempt（mock 云盘草稿路径，演示数据）
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        if (unsaved) doc.unsaved = true
        // 临时文档（从「标签页 +」新建）：只开标签页，不建 FileEntry、不进文件树/库；手动保存才落地。
        if (unsaved) {
          set((s) => ({ docs: [doc, ...s.docs] }))
          get().openDoc(id)
        } else if (inFolder) {
          // 打开的文件夹里新建 = 一份真 .html 文件（进文件树）；否则落云盘「我的草稿」。
          const file: FileEntry = { rootId: root!.id, path: fileName, kind: 'html', docId: id }
          set((s) => ({ docs: [doc, ...s.docs], files: [...s.files, file] }))
          get().openFileTab(file)
        } else {
          set((s) => ({ docs: [doc, ...s.docs] }))
          get().openDoc(id)
        }
        return id
      },

      createLinkedDoc: (rootId, dir, title, ext = '.html') => {
        const root = get().roots.find((r) => r.id === rootId && !r.missing)
        if (!root) return null
        const clean = cleanName(title) || t('sidebar.untitledDoc')
        const path = uniqueFileInDir(get().files, rootId, dir, clean, ext)
        const id = uid('d')
        const doc: Doc = {
          id,
          title: clean,
          emoji: '📄',
          kind: 'doc',
          folderId: rootId,
          blocks: [{ id: uid('b'), type: 'heading', level: 1, html: clean }],
          visibility: 'private',
          localPath: `${root.path}/${path}`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        if (ext === '.md') doc.format = 'markdown'
        const file: FileEntry = { rootId, path, kind: ext === '.md' ? 'md' : 'html', docId: id }
        set((s) => ({ docs: [doc, ...s.docs], files: [...s.files, file] }))
        return path
      },

      // 手动保存：把「临时文档」（unsaved）落进当前空间——连接文件夹里补一个 FileEntry
      // 让它进树，然后清掉 unsaved 标记；已保存的文档只提示一下。
      // Cmd+S / 「保存」：临时文档 → 弹「保存到哪里」modal（选位置）；已保存的文档只提示。
      saveActiveDoc: () => {
        const st = get()
        const tab = st.tabs.find((t) => t.id === st.activeTabId)
        const doc = tab?.docId ? st.getDoc(tab.docId) : undefined
        if (!doc || !doc.unsaved) {
          st.toast(t('sidebar.saved'), 'success')
          return
        }
        useUI.getState().openSave(doc.id)
      },

      // 把临时文档保存到指定根的指定文件夹（dir=''=根目录）。连接文件夹补 FileEntry 进树、清 unsaved。
      saveDocTo: (docId, rootId, dir) => {
        const st = get()
        const doc = st.getDoc(docId)
        if (!doc) return
        // rootId 指定且可达 → 存进那个文件夹；否则退到第一个可达的根（没有云盘草稿了）。
        const root =
          (rootId ? st.roots.find((r) => r.id === rootId && !r.missing) : undefined) ??
          st.roots.find((r) => !r.missing)
        if (root) {
          const path = uniqueFileInDir(st.files, root.id, dir, doc.title, '.html')
          const file: FileEntry = { rootId: root.id, path, kind: 'html', docId }
          set((s) => ({
            docs: s.docs.map((d) =>
              d.id === docId ? { ...d, unsaved: false, localPath: `${root.path}/${path}` } : d,
            ),
            files: [...s.files, file],
          }))
          st.toast(t('sidebar.savedTo', { where: `${root.name}${dir ? ` / ${dir}` : ''}` }), 'success')
        } else {
          // 没有打开任何文件夹的极端情形——只清 unsaved，不落盘。
          set((s) => ({ docs: s.docs.map((d) => (d.id === docId ? { ...d, unsaved: false } : d)) }))
          st.toast(t('sidebar.saved'), 'success')
        }
      },

      // 丢弃未保存文档（未保存关闭时选「不保存直接关闭」）。
      discardDoc: (docId) => set((s) => ({ docs: s.docs.filter((d) => d.id !== docId) })),

      createFromTemplate: (templateId, folderId, target, unsaved = false) => {
        const tpl = get().templates.find((t) => t.id === templateId)
        if (!tpl) return ''
        const id = uid('d')
        const root = target?.rootId ? get().roots.find((r) => r.id === target.rootId && !r.missing) : undefined
        const inFolder = !!root
        const dir = target?.dir ?? ''
        const fileName = inFolder
          ? uniqueFileInDir(get().files, root!.id, dir, tpl.name, '.html')
          : `${tpl.name}.html`
        const doc: Doc = {
          id,
          title: tpl.name,
          emoji: '📄',
          kind: tpl.kind,
          pageFormat: tpl.pageFormat, // 格式模板把纸张版面带到新文档（普通模板为 undefined）
          templateId: tpl.css ? tpl.id : undefined, // 带版式的模板把主题盖章到新文档（骨架模板为 undefined）
          templateCss: tpl.css,
          folderId: inFolder ? root!.id : folderId,
          blocks: tpl.blocks.map((b) => ({ ...b, id: uid('b') })),
          visibility: 'private',
          localPath: inFolder
            ? `${root!.path}/${fileName}`
            : `~/Wordspace/我的草稿/${tpl.name}.html`, // i18n-exempt（mock 云盘草稿路径，演示数据）
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        if (unsaved) doc.unsaved = true
        if (unsaved) {
          set((s) => ({ docs: [doc, ...s.docs] }))
          get().openDoc(id)
        } else if (inFolder) {
          const file: FileEntry = { rootId: root!.id, path: fileName, kind: 'html', docId: id }
          set((s) => ({ docs: [doc, ...s.docs], files: [...s.files, file] }))
          get().openFileTab(file)
        } else {
          set((s) => ({ docs: [doc, ...s.docs] }))
          get().openDoc(id)
        }
        get().toast(t('sidebar.createdFromTemplate', { name: tpl.name }), 'success')
        return id
      },

      saveDocAsTemplate: (docId, name, includeSkeleton) => {
        const s = get()
        const doc = s.docs.find((d) => d.id === docId)
        if (!doc) return
        const clean = name.trim() || t('templates.untitledTemplate')
        // v1 派生通道：css = 文档已应用模板的快照（素颜文档 undefined → 存出纯骨架模板）。
        const css = doc.templateCss
        const skeleton = includeSkeleton
          ? doc.blocks.map((b) => ({ ...b, id: uid('b') }))
          : [{ id: uid('b'), type: 'heading' as const, level: 1 as const, html: clean }]
        const tpl: Template = {
          id: uid('t'),
          name: clean,
          kind: doc.kind,
          category: t('templates.mine'),
          pool: 'private',
          origin: 'user',
          description: [css ? t('templates.descHasTheme') : t('templates.descSkeletonOnly'), includeSkeleton ? t('templates.descWithSkeleton') : ''].filter(Boolean).join(' · '),
          accent: '#1d6fbf',
          css,
          blocks: skeleton,
        }
        set((st) => ({ templates: [...st.templates, tpl] }))
        get().toast(t('templates.savedToast', { name: clean }), 'success')
      },

      renameTemplate: (id, name) => {
        const clean = name.trim()
        if (!clean) return
        set((s) => ({ templates: s.templates.map((t) => (t.id === id ? { ...t, name: clean } : t)) }))
      },

      deleteTemplateWithUndo: (id) => {
        const s = get()
        const idx = s.templates.findIndex((t) => t.id === id)
        if (idx < 0) return
        const removed = s.templates[idx] // 撤销快照（连同原位置）
        set((st) => ({ templates: st.templates.filter((t) => t.id !== id) }))
        get().toast(t('templates.deletedToast', { name: removed.name }), 'neutral', {
          label: t('common.undo'),
          run: () =>
            set((st) => {
              const next = st.templates.slice()
              next.splice(Math.min(idx, next.length), 0, removed)
              return { templates: next }
            }),
        })
      },

      renameDoc: (docId, title) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === docId ? { ...d, title } : d)),
          tabs: s.tabs.map((t) => (t.docId === docId ? { ...t, title } : t)),
        })),

      deleteDoc: (docId) =>
        set((s) => ({
          docs: s.docs.filter((d) => d.id !== docId),
          tabs: s.tabs.filter((t) => t.docId !== docId),
          // also drop its connected-folder file entry, so the tree doesn't keep a
          // dangling row pointing at a deleted doc
          files: s.files.filter((f) => f.docId !== docId),
        })),

      generateDoc: async (prompt, folderId, target) => {
        set({ aiBusy: true })
        await sleep(1700)
        const id = uid('d')
        const title = prompt.slice(0, 18) || t('sidebar.aiGeneratedDoc')
        const root = target?.rootId ? get().roots.find((r) => r.id === target.rootId && !r.missing) : undefined
        const inFolder = !!root
        const dir = target?.dir ?? ''
        const fileName = inFolder
          ? uniqueFileInDir(get().files, root!.id, dir, title, '.html')
          : `${title}.html`
        const doc: Doc = {
          id,
          title,
          emoji: '✨',
          kind: 'doc',
          folderId: inFolder ? root!.id : folderId,
          // i18n-exempt-start —— 假 AI 生成的文档正文（演示数据；真 AI 输出是用户内容，本就不该按 UI 语言翻）。
          blocks: [
            { id: uid('b'), type: 'heading', level: 1, html: title },
            { id: uid('b'), type: 'text', html: '这是 Wordspace 根据你的描述生成的初稿。下面的结构和文字都可以直接改,或再让 AI 调整。' },
            { id: uid('b'), type: 'heading', level: 2, html: '背景' },
            { id: uid('b'), type: 'text', html: '根据「' + prompt + '」整理的要点。' },
            { id: uid('b'), type: 'list', html: '<li>第一点</li><li>第二点</li><li>第三点</li>' },
            { id: uid('b'), type: 'callout', html: '需要更正式的版式,可以让 AI 把某一段做成带设计的区域。' },
          ],
          // i18n-exempt-end
          visibility: 'private',
          localPath: inFolder
            ? `${root!.path}/${fileName}`
            : `~/Wordspace/我的草稿/${title}.html`, // i18n-exempt（mock 云盘草稿路径，演示数据）
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        if (inFolder) {
          const file: FileEntry = { rootId: root!.id, path: fileName, kind: 'html', docId: id }
          set((s) => ({ docs: [doc, ...s.docs], files: [...s.files, file], aiBusy: false }))
          get().openFileTab(file)
        } else {
          set((s) => ({ docs: [doc, ...s.docs], aiBusy: false }))
          get().openDoc(id)
        }
        get().toast(t('sidebar.aiDraftCreated'), 'success')
        return id
      },

      redesignBlock: async (docId, blockId, prompt) => {
        set({ aiBusy: true })
        await sleep(1500)
        /* i18n-exempt-start —— 假 AI 重新设计输出的装饰块（演示数据，用户文档内容不翻）。 */
        const designed = `<div style="background:linear-gradient(135deg,#16307a,#2f6fe0 60%,#5b93f2);color:#fff;border-radius:12px;padding:40px 36px;">
          <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;">由 AI 重新设计</div>
          <div style="font-size:28px;font-weight:800;margin:10px 0 8px;">${prompt || '重点板块'}</div>
          <div style="font-size:15px;opacity:.92;max-width:460px;line-height:1.6;">这一块被 AI 改成了带背景和版式的设计区域。文字仍可就地编辑,整块也能继续让 AI 调整。</div>
        </div>`
        /* i18n-exempt-end */
        set((s) => ({
          aiBusy: false,
          docs: s.docs.map((d) =>
            d.id !== docId
              ? d
              : {
                  ...d,
                  updatedAt: Date.now(),
                  blocks: d.blocks.map((b) =>
                    b.id === blockId
                      ? { ...b, type: 'embed', designed: true, html: designed }
                      : b,
                  ),
                },
          ),
        }))
        get().toast(t('sidebar.aiBlockRestyled'), 'success')
      },

      setVisibility: (docId, v) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === docId ? { ...d, visibility: v } : d)),
        })),

      publishDoc: async (docId, v) => {
        const doc = get().getDoc(docId)
        if (!doc) return
        get().toast(t('sidebar.deploying', { target: get().workspace.deployTarget }), 'progress')
        await sleep(1600)
        const slug = doc.title.replace(/\s+/g, '-')
        const url =
          v === 'public'
            ? `https://tenthglobal.com/${encodeURIComponent(slug)}`
            : v === 'internal'
              ? `https://team.tenthglobal.com/${encodeURIComponent(slug)}`
              : doc.publishedUrl
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id === docId
              ? { ...d, visibility: v, publishedUrl: url, deployedAt: Date.now() }
              : d,
          ),
          tabs: s.tabs.map((t) =>
            t.docId === docId && url ? { ...t, url } : t,
          ),
        }))
        get().dismissAllProgress()
        get().toast(
          v === 'public' || v === 'internal' ? t('sidebar.published') : t('sidebar.visibilityUpdated'),
          'success',
        )
      },

      inviteCollaborator: (docId, email) =>
        set((s) => ({
          docs: s.docs.map((d) => {
            if (d.id !== docId) return d
            const m = s.members.find((x) => x.email === email)
            const memberId = m?.id ?? email
            if (d.collaborators.includes(memberId)) return d
            return { ...d, collaborators: [...d.collaborators, memberId] }
          }),
        })),

      exportDoc: async (docId, format) => {
        const labels = { pdf: 'PDF', docx: 'Word', pptx: 'PPT' }
        get().toast(t('sidebar.exporting', { format: labels[format] }), 'progress')
        await sleep(1400)
        get().dismissAllProgress()
        get().toast(t('sidebar.exported', { format: labels[format] }), 'success')
      },

      setPresence: (p) => set({ presence: p }),

      addAgentEvent: (e) =>
        set((s) => ({
          agentEvents: [
            { ...e, id: uid('e'), at: Date.now() },
            ...s.agentEvents,
          ].slice(0, 40),
        })),

      toast: (message, tone = 'neutral', action) => {
        const id = uid('toast')
        set((s) => ({ toasts: [...s.toasts, { id, message, tone, action }] }))
        // actionable toasts (e.g. 撤销) linger so the user can reach the button；hint 教学气泡给足阅读时间
        if (tone !== 'progress')
          setTimeout(() => get().dismissToast(id), action ? 6500 : tone === 'hint' ? 4200 : 2600)
        return id
      },

      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      resetAll: () => {
        set({ ...freshData() })
        get().toast(t('sidebar.resetDone'), 'neutral')
      },

      // internal helper exposed on the object for convenience
      dismissAllProgress: () =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.tone !== 'progress') })),
    } as State & { dismissAllProgress: () => void }),
    {
      name: 'wordspace-demo',
      version: SEED_VERSION,
      partialize: (s) => ({
        workspace: s.workspace,
        members: s.members,
        folders: s.folders,
        docs: s.docs,
        templates: s.templates,
        agentEvents: s.agentEvents,
        roots: s.roots,
        files: s.files,
        dirs: s.dirs,
        // 会话恢复：重开 app（刷新）后恢复上次开着的标签与激活标签。
        tabs: s.tabs,
        activeTabId: s.activeTabId,
      }),
      migrate: () => ({ ...freshData() }) as never,
    },
  ),
)

// expose a reset for development / kiosk reset
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__resetWordspace = () => {
    localStorage.removeItem('wordspace-demo')
    localStorage.removeItem('wordspace-browser')
    location.reload()
  }
  // 测试 seam（同 __resetWordspace 惯例）：让 Playwright 门脚本直接驱动 store/ui 状态、
  // 断言真实渲染（scripts/test-template-ui.mjs）。仅暴露引用，不改任何行为。
  ;(window as unknown as Record<string, unknown>).__wsStore = useStore
  ;(window as unknown as Record<string, unknown>).__wsUI = useUI
}
