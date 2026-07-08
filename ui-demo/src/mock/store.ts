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
import { rewriteDocsForMoves, dirOf } from '../lib/links'
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
const SEED_VERSION = 22

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
  activeTabId: string
  toasts: Toast[]
  presence: Presence[]
  aiBusy: boolean

  // selectors
  getDoc: (id: string) => Doc | undefined
  getMember: (id: string) => Member | undefined

  // tabs
  openDoc: (docId: string) => void
  openWebTab: (url: string, title: string) => void
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
  ) => string
  deleteBlock: (docId: string, blockId: string) => void
  setBlockType: (
    docId: string,
    blockId: string,
    type: BlockType,
    level?: 1 | 2 | 3,
    listStyle?: ListStyle,
  ) => void
  duplicateBlock: (docId: string, blockId: string) => string

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
  // @提及里选「新建」：在 dir 下静默建一份 .html（不切走当前标签页——Notion 同款，链接插完人还在原文档），返回新文件根内路径。
  createLinkedDoc: (rootId: string, dir: string, title: string) => string | null
  createFromTemplate: (templateId: string, folderId: string, target?: { rootId: string; dir: string } | null, unsaved?: boolean) => string
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

// 撤销历史用的 docs 深拷贝（只拷到 blocks 这层，够本 mock 用）。
const cloneDocs = (docs: Doc[]): Doc[] =>
  docs.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b })) }))

const newBlock = (type: BlockType, listStyle?: ListStyle): Block => {
  const base: Record<BlockType, Partial<Block>> = {
    heading: { level: 2, html: '新标题' },
    text: { html: '' },
    list: { html: '<li>列表项</li>' },
    quote: { html: '引用内容' },
    image: { html: '图片' },
    divider: { html: '' },
    callout: { html: '提示内容' },
    embed: { html: '' },
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
      tabs: [
        // 置顶 (pinned)
        { id: 'tab-1', docId: 'd-handbook', kind: 'doc', pinned: true, title: '员工手册', url: 'https://team.tenthglobal.com/handbook' },
        { id: 'tab-tg', kind: 'web', pinned: true, title: 'Tenth Global', url: 'https://tenthglobal.com' },
        { id: 'tab-flow', kind: 'web', pinned: true, title: 'FlowDesk', url: 'https://flowdesk.app' },
        // 标签页 (transient)
        { id: 'tab-web', kind: 'web', title: 'Designer News · 行业动态', url: 'https://news.design/today' },
        // 开局落在一篇本地 .html 文档上，直接进编辑器
        { id: 'tab-local', kind: 'doc', docId: 'd-recruit', title: '落地页.html', url: '落地页.html', fileName: '落地页.html', fileKind: 'html', rootId: 'r-brand' },
      ],
      activeTabId: 'tab-local',
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

      openWebTab: (url, title) => {
        const tab: Tab = { id: uid('tab'), kind: 'web', title, url }
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
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
          get().toast(`已更新 ${rewrite.changed.length} 篇文档里的链接`, 'success', {
            label: '撤销',
            run: () =>
              set((s) => ({
                // 撤销 = 名字改回 + 引用方旧块恢复（一体撤销，不留半套状态）
                files: s.files.map((f) =>
                  f.rootId === file.rootId && f.path === newPath ? { ...f, path: file.path } : f,
                ),
                tabs: s.tabs.map((t) =>
                  t.fileName && t.rootId === file.rootId && t.url === newPath
                    ? { ...t, url: file.path, fileName: baseOfPath(file.path), title: baseOfPath(file.path) }
                    : t,
                ),
                docs: s.docs.map((d) => {
                  const c = rewrite.changed.find((x) => x.docId === d.id)
                  return c ? { ...d, blocks: c.oldBlocks } : d
                }),
              })),
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
        get().toast(`已删除「${name}」`, 'neutral', {
          label: '撤销',
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
        const path = uniqueDirPath(get().files, get().dirs, rootId, dirPath, '新建文件夹')
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
          get().toast(`已更新 ${rewrite.changed.length} 篇文档里的链接`, 'success')
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
          cnt ? `已删除文件夹「${leaf}」(${cnt} 个文件)` : `已删除文件夹「${leaf}」`,
          'neutral',
          {
            label: '撤销',
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
        const rewrite = rewriteDocsForMoves(pre.docs, pre.files, file.rootId, new Map([[file.path, newPath]]))
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
        get().toast(
          `已移动「${leaf}」到 ${destDir || '根目录'}` +
            (rewrite.changed.length ? ` · 已更新 ${rewrite.changed.length} 篇文档里的链接` : ''),
          'neutral',
        )
      },

      newBrowserTab: () => {
        const tab: Tab = { id: uid('tab'), kind: 'web', title: '新标签页', url: '' }
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
        get().toast(`已打开文件夹「${root.name}」`, 'success')
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
        get().toast(`「${root.name}」已并入，含原来的子文件夹`, 'success')
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
        get().toast(`已移除「${root.name}」（磁盘文件不受影响）`, 'neutral', {
          label: '撤销',
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
        get().toast(`「${root.name}」已重新连接`, 'success')
      },

      closeTab: (tabId) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== tabId)
          let activeTabId = s.activeTabId
          if (s.activeTabId === tabId) activeTabId = tabs[tabs.length - 1]?.id ?? ''
          return { tabs, activeTabId }
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

      addBlock: (docId, afterId, type, listStyle) => {
        const block = newBlock(type, listStyle)
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
                    // 跨列表边界时同步转换内容形态（幂等：内容已就位则不动）
                    let html = b.html
                    if (willList && !wasList) html = toListHtml(b.html)
                    else if (!willList && wasList) html = fromListHtml(b.html)
                    return {
                      ...b,
                      type,
                      html,
                      level:
                        type === 'heading' ? level ?? b.level ?? 2 : undefined,
                      listStyle: willList
                        ? listStyle ?? b.listStyle ?? 'bulleted'
                        : undefined,
                    }
                  }),
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

      createDoc: (folderId, kind = 'doc', title = '无标题文档', target, unsaved = false) => {
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
            : `~/Wordspace/我的草稿/${title}.html`,
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

      createLinkedDoc: (rootId, dir, title) => {
        const root = get().roots.find((r) => r.id === rootId && !r.missing)
        if (!root) return null
        const clean = cleanName(title) || '无标题文档'
        const path = uniqueFileInDir(get().files, rootId, dir, clean, '.html')
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
        const file: FileEntry = { rootId, path, kind: 'html', docId: id }
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
          st.toast('已保存', 'success')
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
          st.toast(`已保存到 ${root.name}${dir ? ` / ${dir}` : ''}`, 'success')
        } else {
          // 没有打开任何文件夹的极端情形——只清 unsaved，不落盘。
          set((s) => ({ docs: s.docs.map((d) => (d.id === docId ? { ...d, unsaved: false } : d)) }))
          st.toast('已保存', 'success')
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
          folderId: inFolder ? root!.id : folderId,
          blocks: tpl.blocks.map((b) => ({ ...b, id: uid('b') })),
          visibility: 'private',
          localPath: inFolder
            ? `${root!.path}/${fileName}`
            : `~/Wordspace/我的草稿/${tpl.name}.html`,
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
        get().toast(`已从模板「${tpl.name}」创建`, 'success')
        return id
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
        const title = prompt.slice(0, 18) || 'AI 生成的文档'
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
          blocks: [
            { id: uid('b'), type: 'heading', level: 1, html: title },
            { id: uid('b'), type: 'text', html: '这是 Wordspace 根据你的描述生成的初稿。下面的结构和文字都可以直接改,或再让 AI 调整。' },
            { id: uid('b'), type: 'heading', level: 2, html: '背景' },
            { id: uid('b'), type: 'text', html: '根据「' + prompt + '」整理的要点。' },
            { id: uid('b'), type: 'list', html: '<li>第一点</li><li>第二点</li><li>第三点</li>' },
            { id: uid('b'), type: 'callout', html: '需要更正式的版式,可以让 AI 把某一段做成带设计的区域。' },
          ],
          visibility: 'private',
          localPath: inFolder
            ? `${root!.path}/${fileName}`
            : `~/Wordspace/我的草稿/${title}.html`,
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
        get().toast('AI 已生成初稿', 'success')
        return id
      },

      redesignBlock: async (docId, blockId, prompt) => {
        set({ aiBusy: true })
        await sleep(1500)
        const designed = `<div style="background:linear-gradient(135deg,#16307a,#2f6fe0 60%,#5b93f2);color:#fff;border-radius:12px;padding:40px 36px;">
          <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;">由 AI 重新设计</div>
          <div style="font-size:28px;font-weight:800;margin:10px 0 8px;">${prompt || '重点板块'}</div>
          <div style="font-size:15px;opacity:.92;max-width:460px;line-height:1.6;">这一块被 AI 改成了带背景和版式的设计区域。文字仍可就地编辑,整块也能继续让 AI 调整。</div>
        </div>`
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
        get().toast('AI 已重排这一块', 'success')
      },

      setVisibility: (docId, v) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === docId ? { ...d, visibility: v } : d)),
        })),

      publishDoc: async (docId, v) => {
        const doc = get().getDoc(docId)
        if (!doc) return
        get().toast('正在部署到 ' + get().workspace.deployTarget + ' …', 'progress')
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
          v === 'public' || v === 'internal' ? '已发布,链接已生成' : '可见范围已更新',
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
        get().toast(`正在导出为 ${labels[format]} …`, 'progress')
        await sleep(1400)
        get().dismissAllProgress()
        get().toast(`已导出为 ${labels[format]}`, 'success')
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
        // actionable toasts (e.g. 撤销) linger so the user can reach the button
        if (tone !== 'progress')
          setTimeout(() => get().dismissToast(id), action ? 6500 : 2600)
        return id
      },

      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      resetAll: () => {
        set({ ...freshData() })
        get().toast('已重置为初始数据', 'neutral')
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
}
