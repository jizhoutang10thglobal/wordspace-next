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
  Presence,
  Space,
  StorageKind,
  Tab,
  Template,
  Toast,
  Visibility,
  Workspace,
} from '../types'
import { STORAGE_META, isCloudStorage } from '../types'
import {
  ME_ID,
  seedAgentEvents,
  seedDocs,
  seedFiles,
  seedFolders,
  seedMembers,
  seedSpaces,
  seedTemplates,
  seedWorkspace,
} from './seed'

// Bump when the shape of seed data changes so a reload reseeds cleanly.
const SEED_VERSION = 8

const uid = (p = 'id') =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A unique "<base>.html" (or "<base> 2.html", …) among a connected folder's
// existing files, so a second new doc doesn't collide with the first.
function uniqueFilePath(files: FileEntry[], spaceId: string, base: string): string {
  const taken = new Set(files.filter((f) => f.spaceId === spaceId).map((f) => f.path))
  let name = `${base}.html`
  let n = 2
  while (taken.has(name)) {
    name = `${base} ${n}.html`
    n++
  }
  return name
}

// Strip path separators so a typed name can't silently spawn a directory level,
// and trim. Returns '' when nothing usable is left.
const cleanName = (raw: string): string => raw.replace(/[/\\]/g, '').trim()

// Every directory path that exists in a space — both explicit (dirs list) and
// implied by a file's path prefix.
function dirPathsOf(
  files: FileEntry[],
  dirs: { spaceId: string; path: string }[],
  spaceId: string,
): Set<string> {
  const set = new Set<string>()
  for (const d of dirs) if (d.spaceId === spaceId) set.add(d.path)
  for (const f of files)
    if (f.spaceId === spaceId) {
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

// A collision-free "<dir>/<base><ext>" among a space's files.
function uniqueFileInDir(
  files: FileEntry[],
  spaceId: string,
  dir: string,
  base: string,
  ext: string,
): string {
  const taken = new Set(files.filter((f) => f.spaceId === spaceId).map((f) => f.path))
  const prefix = dir ? `${dir}/` : ''
  let name = `${prefix}${base}${ext}`
  let n = 2
  while (taken.has(name)) {
    name = `${prefix}${base} ${n}${ext}`
    n++
  }
  return name
}

// A collision-free "<parent>/<base>" among a space's directories.
function uniqueDirPath(
  files: FileEntry[],
  dirs: { spaceId: string; path: string }[],
  spaceId: string,
  parent: string,
  base: string,
): string {
  const taken = dirPathsOf(files, dirs, spaceId)
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
  spaces: Space[]
  files: FileEntry[] // contents of connected-folder spaces
  dirs: { spaceId: string; path: string }[] // known directories (incl. empty ones)

  // transient ui (not persisted)
  meId: string
  activeSpaceId: string
  tabs: Tab[]
  activeTabId: string
  activeTabBySpace: Record<string, string> // remembers each space's last-active tab
  toasts: Toast[]
  presence: Presence[]
  aiBusy: boolean

  // selectors
  getDoc: (id: string) => Doc | undefined
  getMember: (id: string) => Member | undefined

  // tabs + spaces
  openDoc: (docId: string) => void
  openWebTab: (url: string, title: string) => void
  openFileTab: (file: FileEntry) => void
  renameFile: (file: FileEntry, newBase: string) => void
  deleteFileWithUndo: (file: FileEntry) => void
  // connected-folder organize ops (path-based; folders are implicit + the dirs list)
  createFileInDir: (dirPath: string) => void
  createSubfolder: (dirPath: string) => void
  renameDir: (dirPath: string, newName: string) => void
  deleteDirWithUndo: (dirPath: string) => void
  moveFile: (file: FileEntry, destDir: string) => void
  newBrowserTab: () => void
  setTabUrl: (tabId: string, url: string, title?: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  dropTab: (tabId: string, pinned: boolean, toIndex: number) => void
  togglePin: (tabId: string) => void
  setActiveSpace: (spaceId: string) => void
  createSpace: (name: string, storage: StorageKind, mountPath?: string) => void

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

  // documents
  createDoc: (folderId: string, kind?: DocKind, title?: string) => string
  createFromTemplate: (templateId: string, folderId: string) => string
  renameDoc: (docId: string, title: string) => void
  deleteDoc: (docId: string) => void

  // ai (simulated)
  generateDoc: (prompt: string, folderId: string) => Promise<string>
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

function freshData() {
  return {
    workspace: { ...seedWorkspace },
    members: seedMembers.map((m) => ({ ...m })),
    folders: seedFolders.map((f) => ({ ...f })),
    docs: seedDocs.map((d) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b })) })),
    templates: seedTemplates.map((t) => ({ ...t })),
    agentEvents: seedAgentEvents.map((e) => ({ ...e })),
    spaces: seedSpaces.map((s) => ({ ...s })),
    files: seedFiles.map((f) => ({ ...f })),
    dirs: [] as { spaceId: string; path: string }[],
  }
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
      activeSpaceId: 'sp-tg',
      tabs: [
        // sp-tg · 置顶 (pinned)
        { id: 'tab-1', spaceId: 'sp-tg', docId: 'd-handbook', kind: 'doc', pinned: true, title: '员工手册', url: 'https://team.tenthglobal.com/handbook' },
        { id: 'tab-tg', spaceId: 'sp-tg', kind: 'web', pinned: true, title: 'Tenth Global', url: 'https://tenthglobal.com' },
        { id: 'tab-flow', spaceId: 'sp-tg', kind: 'web', pinned: true, title: 'FlowDesk', url: 'https://flowdesk.app' },
        // sp-tg · 标签页 (transient)
        { id: 'tab-strategy', spaceId: 'sp-tg', docId: 'd-strategy', kind: 'doc', title: '2026 公司战略', url: '~/Wordspace/团队/战略/2026战略.html' },
        { id: 'tab-web', spaceId: 'sp-tg', kind: 'web', title: 'Designer News · 行业动态', url: 'https://news.design/today' },
        // connected folders start with a transient new tab
        { id: 'tab-drive', spaceId: 'sp-drive', kind: 'web', title: '新标签页', url: '' },
        { id: 'tab-local', spaceId: 'sp-local', kind: 'web', title: '新标签页', url: '' },
      ],
      activeTabId: 'tab-1',
      activeTabBySpace: { 'sp-tg': 'tab-1', 'sp-drive': 'tab-drive', 'sp-local': 'tab-local' },
      toasts: [],
      presence: [],
      aiBusy: false,

      getDoc: (id) => get().docs.find((d) => d.id === id),
      getMember: (id) => get().members.find((m) => m.id === id),

      openDoc: (docId) => {
        const doc = get().getDoc(docId)
        if (!doc) return
        const space = get().activeSpaceId
        const existing = get().tabs.find(
          (t) => t.docId === docId && t.spaceId === space && !t.fileName,
        )
        if (existing) {
          set((s) => ({
            activeTabId: existing.id,
            activeTabBySpace: { ...s.activeTabBySpace, [space]: existing.id },
          }))
          return
        }
        const tab: Tab = {
          id: uid('tab'),
          spaceId: space,
          docId,
          kind: 'doc',
          title: doc.title,
          url: doc.publishedUrl ?? doc.localPath,
        }
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
          activeTabBySpace: { ...s.activeTabBySpace, [space]: tab.id },
        }))
      },

      openWebTab: (url, title) => {
        const space = get().activeSpaceId
        const tab: Tab = { id: uid('tab'), spaceId: space, kind: 'web', title, url }
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
          activeTabBySpace: { ...s.activeTabBySpace, [space]: tab.id },
        }))
      },

      // Open a file from a connected folder. HTML opens in the editor (a 'doc'
      // tab linked to its doc, but labeled with the file name); every other type
      // opens the "not HTML, open externally" panel. A file already open in the
      // space is reused, not duplicated.
      openFileTab: (file) => {
        const space = get().activeSpaceId
        const existing = get().tabs.find(
          (t) => !!t.fileName && t.spaceId === space && t.url === file.path,
        )
        if (existing) {
          set((s) => ({
            activeTabId: existing.id,
            activeTabBySpace: { ...s.activeTabBySpace, [space]: existing.id },
          }))
          return
        }
        const name = file.path.split('/').pop() ?? file.path
        const html = file.kind === 'html' && !!file.docId
        const tab: Tab = {
          id: uid('tab'),
          spaceId: space,
          kind: html ? 'doc' : 'file',
          docId: html ? file.docId : undefined,
          title: name,
          url: file.path,
          fileName: name,
          fileKind: file.kind,
        }
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
          activeTabBySpace: { ...s.activeTabBySpace, [space]: tab.id },
        }))
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
        // dedupe against siblings (excluding this file), like the create flow does
        const others = get().files.filter(
          (f) => !(f.spaceId === file.spaceId && f.path === file.path),
        )
        const newPath = uniqueFileInDir(others, file.spaceId, dir, base, ext)
        const newName = newPath.split('/').pop() ?? newPath
        set((s) => ({
          files: s.files.map((f) =>
            f.spaceId === file.spaceId && f.path === file.path ? { ...f, path: newPath } : f,
          ),
          tabs: s.tabs.map((t) =>
            t.fileName && t.spaceId === file.spaceId && t.url === file.path
              ? { ...t, url: newPath, fileName: newName, title: newName }
              : t,
          ),
        }))
      },

      // Delete a file but keep it recoverable: snapshot what we remove, then show
      // a toast with 撤销 that puts it back. Guard against the cross-file cascade —
      // only drop the backing doc if NO other file (in any space) still points at
      // it, so deleting one .html never silently destroys another file's content.
      deleteFileWithUndo: (file) => {
        const s = get()
        const prevActiveTabId = s.activeTabId
        const prevBySpace = s.activeTabBySpace[file.spaceId]
        const sharedByOther = s.files.some(
          (f) =>
            f.docId &&
            f.docId === file.docId &&
            !(f.spaceId === file.spaceId && f.path === file.path),
        )
        const removedDoc =
          file.docId && !sharedByOther ? s.docs.find((d) => d.id === file.docId) : undefined
        const removedTabs = s.tabs.filter(
          (t) => t.fileName && t.spaceId === file.spaceId && t.url === file.path,
        )
        const removedTabIds = new Set(removedTabs.map((t) => t.id))
        set((st) => {
          const files = st.files.filter(
            (f) => !(f.spaceId === file.spaceId && f.path === file.path),
          )
          const docs = removedDoc ? st.docs.filter((d) => d.id !== removedDoc.id) : st.docs
          const tabs = st.tabs.filter((t) => !removedTabIds.has(t.id))
          let activeTabId = st.activeTabId
          const activeTabBySpace = { ...st.activeTabBySpace }
          if (removedTabIds.has(st.activeTabId)) {
            const sameSpace = tabs.filter((t) => t.spaceId === file.spaceId)
            const next = sameSpace[sameSpace.length - 1]?.id ?? ''
            activeTabBySpace[file.spaceId] = next
            if (st.activeSpaceId === file.spaceId) activeTabId = next
          }
          return { files, docs, tabs, activeTabId, activeTabBySpace }
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
              activeTabBySpace: { ...st.activeTabBySpace, [file.spaceId]: prevBySpace },
            })),
        })
      },

      // Create a new .html doc directly inside `dirPath` of the active connected
      // folder (dirPath '' = the mount root), so 新建 lands where you clicked.
      createFileInDir: (dirPath) => {
        const space = get().spaces.find((sp) => sp.id === get().activeSpaceId)
        if (!space || isCloudStorage(space.storage)) return
        const id = uid('d')
        const title = '无标题文档'
        const path = uniqueFileInDir(get().files, space.id, dirPath, title, '.html')
        const doc: Doc = {
          id,
          title,
          emoji: '📄',
          kind: 'doc',
          folderId: space.id,
          blocks: [{ id: uid('b'), type: 'heading', level: 1, html: title }],
          visibility: 'private',
          localPath: `${space.mountPath ?? '~'}/${path}`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        const file: FileEntry = { spaceId: space.id, path, kind: 'html', docId: id }
        set((s) => ({ docs: [doc, ...s.docs], files: [...s.files, file] }))
        get().openFileTab(file)
      },

      // Create an (initially empty) subfolder under `dirPath`. Empty folders are
      // tracked in `dirs` so the tree can show them before they hold any file.
      createSubfolder: (dirPath) => {
        const space = get().spaces.find((sp) => sp.id === get().activeSpaceId)
        if (!space || isCloudStorage(space.storage)) return
        const path = uniqueDirPath(get().files, get().dirs, space.id, dirPath, '新建文件夹')
        set((s) => ({ dirs: [...s.dirs, { spaceId: space.id, path }] }))
      },

      // Rename a directory: rewrite the path prefix of every file, sub-dir, and
      // open tab living under it. Sanitized + deduped against sibling dirs.
      renameDir: (dirPath, newName) => {
        const space = get().spaces.find((sp) => sp.id === get().activeSpaceId)
        if (!space || isCloudStorage(space.storage)) return
        const clean = cleanName(newName)
        if (!clean) return
        const segs = dirPath.split('/')
        segs.pop()
        const parent = segs.join('/')
        const base = parent ? `${parent}/` : ''
        const naive = `${base}${clean}`
        if (naive === dirPath) return
        const oldPrefix = `${dirPath}/`
        const taken = dirPathsOf(get().files, get().dirs, space.id)
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
        set((s) => ({
          files: s.files.map((f) => (f.spaceId === space.id ? { ...f, path: remap(f.path) } : f)),
          dirs: s.dirs.map((d) => (d.spaceId === space.id ? { ...d, path: remap(d.path) } : d)),
          tabs: s.tabs.map((t) =>
            t.fileName && t.spaceId === space.id && t.url ? { ...t, url: remap(t.url) } : t,
          ),
        }))
      },

      // Delete a directory and everything under it, recoverably. Same backing-doc
      // guard as deleteFileWithUndo: a doc is dropped only if no surviving file
      // still references it.
      deleteDirWithUndo: (dirPath) => {
        const spaceId = get().activeSpaceId
        const s = get()
        const prevActiveTabId = s.activeTabId
        const prevBySpace = s.activeTabBySpace[spaceId]
        const prefix = `${dirPath}/`
        const removedFiles = s.files.filter(
          (f) => f.spaceId === spaceId && (f.path === dirPath || f.path.startsWith(prefix)),
        )
        const removedKeys = new Set(removedFiles.map((f) => f.path))
        const removedDirs = s.dirs.filter(
          (d) => d.spaceId === spaceId && (d.path === dirPath || d.path.startsWith(prefix)),
        )
        if (!removedFiles.length && !removedDirs.length) return
        const survivingFiles = s.files.filter(
          (f) => !(f.spaceId === spaceId && removedKeys.has(f.path)),
        )
        const removedDocs = s.docs.filter(
          (d) =>
            removedFiles.some((f) => f.docId === d.id) &&
            !survivingFiles.some((sf) => sf.docId === d.id),
        )
        const removedTabs = s.tabs.filter(
          (t) => t.fileName && t.spaceId === spaceId && removedKeys.has(t.url),
        )
        const removedTabIds = new Set(removedTabs.map((t) => t.id))
        set((st) => {
          const files = st.files.filter(
            (f) => !(f.spaceId === spaceId && removedKeys.has(f.path)),
          )
          const dirs = st.dirs.filter(
            (d) => !(d.spaceId === spaceId && (d.path === dirPath || d.path.startsWith(prefix))),
          )
          const docs = removedDocs.length
            ? st.docs.filter((d) => !removedDocs.some((rd) => rd.id === d.id))
            : st.docs
          const tabs = st.tabs.filter((t) => !removedTabIds.has(t.id))
          let activeTabId = st.activeTabId
          const activeTabBySpace = { ...st.activeTabBySpace }
          if (removedTabIds.has(st.activeTabId)) {
            const sameSpace = tabs.filter((t) => t.spaceId === spaceId)
            const next = sameSpace[sameSpace.length - 1]?.id ?? ''
            activeTabBySpace[spaceId] = next
            if (st.activeSpaceId === spaceId) activeTabId = next
          }
          return { files, dirs, docs, tabs, activeTabId, activeTabBySpace }
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
                activeTabBySpace: { ...st.activeTabBySpace, [spaceId]: prevBySpace },
              })),
          },
        )
      },

      // Move a file into `destDir` (relative to the mount; '' = root) by rewriting
      // its path prefix, deduping the leaf against whatever already lives there.
      moveFile: (file, destDir) => {
        const leaf = file.path.split('/').pop() ?? file.path
        const dot = leaf.lastIndexOf('.')
        const base = dot > 0 ? leaf.slice(0, dot) : leaf
        const ext = dot > 0 ? leaf.slice(dot) : ''
        const others = get().files.filter(
          (f) => !(f.spaceId === file.spaceId && f.path === file.path),
        )
        const newPath = uniqueFileInDir(others, file.spaceId, destDir, base, ext)
        if (newPath === file.path) return // dropped onto its own folder — no-op
        set((s) => ({
          files: s.files.map((f) =>
            f.spaceId === file.spaceId && f.path === file.path ? { ...f, path: newPath } : f,
          ),
          tabs: s.tabs.map((t) =>
            t.fileName && t.spaceId === file.spaceId && t.url === file.path
              ? { ...t, url: newPath }
              : t,
          ),
        }))
        get().toast(`已移动「${leaf}」到 ${destDir || '根目录'}`, 'neutral')
      },

      newBrowserTab: () => {
        const space = get().activeSpaceId
        const tab: Tab = { id: uid('tab'), spaceId: space, kind: 'web', title: '新标签页', url: '' }
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: tab.id,
          activeTabBySpace: { ...s.activeTabBySpace, [space]: tab.id },
        }))
      },

      setTabUrl: (tabId, url, title) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, url, title: title ?? t.title } : t,
          ),
        })),

      // Switching space swaps the whole context: its tabs, its favorites (in the
      // sidebar) and its library. The active tab follows to that space's tab.
      setActiveSpace: (spaceId) =>
        set((s) => {
          const remembered = s.activeTabBySpace[spaceId]
          const valid = remembered && s.tabs.some((t) => t.id === remembered && t.spaceId === spaceId)
          const fallback = s.tabs.find((t) => t.spaceId === spaceId)?.id ?? ''
          return { activeSpaceId: spaceId, activeTabId: valid ? remembered : fallback }
        }),

      // Create a new space (a work scenario) and pick where it lives. The chosen
      // storage is what decides its capabilities, so it is set here at creation.
      createSpace: (name, storage, mountPath) => {
        const id = uid('sp')
        const palette = ['#1a73e8', '#1e8e3e', '#b8541d', '#8a3ffc', '#0b8793', '#d4356b']
        const trimmed = name.trim() || '新空间'
        const space: Space = {
          id,
          name: trimmed,
          kind: 'project',
          storage,
          badge: trimmed.slice(0, 1).toUpperCase(),
          color: palette[get().spaces.length % palette.length],
          subtitle: mountPath ?? STORAGE_META[storage].label,
          mountPath,
        }
        // A cloud space is an isolated workspace, so it gets its own private
        // folder; a connected folder uses its on-disk files instead.
        const newFolders: Folder[] = isCloudStorage(storage)
          ? [{ id: uid('f'), name: '我的草稿', scope: 'personal', spaceId: id, order: 0 }]
          : []
        const tab: Tab = { id: uid('tab'), spaceId: id, kind: 'web', title: '新标签页', url: '' }
        set((s) => ({
          spaces: [...s.spaces, space],
          folders: [...s.folders, ...newFolders],
          tabs: [...s.tabs, tab],
          activeSpaceId: id,
          activeTabId: tab.id,
          activeTabBySpace: { ...s.activeTabBySpace, [id]: tab.id },
        }))
        get().toast(`已新建空间「${trimmed}」`, 'success')
      },

      closeTab: (tabId) =>
        set((s) => {
          const closing = s.tabs.find((t) => t.id === tabId)
          const tabs = s.tabs.filter((t) => t.id !== tabId)
          let activeTabId = s.activeTabId
          const activeTabBySpace = { ...s.activeTabBySpace }
          if (closing && activeTabBySpace[closing.spaceId] === tabId) {
            // pick another tab in the same space to become its active one
            const sameSpace = tabs.filter((t) => t.spaceId === closing.spaceId)
            const next = sameSpace[sameSpace.length - 1]?.id ?? ''
            activeTabBySpace[closing.spaceId] = next
            if (s.activeSpaceId === closing.spaceId) activeTabId = next
          }
          return { tabs, activeTabId, activeTabBySpace }
        }),

      setActiveTab: (tabId) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId)
          if (!tab) return { activeTabId: tabId }
          return {
            activeTabId: tabId,
            activeTabBySpace: { ...s.activeTabBySpace, [tab.spaceId]: tabId },
          }
        }),

      // Drop a dragged tab into a (space, pinned?) group at a position: this both
      // sets its pinned state (so a tab moves between 标签页 and 置顶) and reorders
      // it within that group.
      dropTab: (tabId, pinned, toIndex) =>
        set((s) => {
          const tab = s.tabs.find((t) => t.id === tabId)
          if (!tab) return s
          const moved = { ...tab, pinned }
          const inGroup = s.tabs.filter(
            (t) => t.id !== tabId && t.spaceId === tab.spaceId && !!t.pinned === pinned,
          )
          const others = s.tabs.filter(
            (t) => t.id !== tabId && !(t.spaceId === tab.spaceId && !!t.pinned === pinned),
          )
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

      createDoc: (folderId, kind = 'doc', title = '无标题文档') => {
        const id = uid('d')
        const space = get().spaces.find((sp) => sp.id === get().activeSpaceId)
        const inFolder = !!space && !isCloudStorage(space.storage)
        const fileName = inFolder ? uniqueFilePath(get().files, space!.id, title) : `${title}.html`
        // A cloud doc lands in its own space's private folder (spaces are isolated);
        // a connected-folder doc is tracked by its FileEntry, not a cloud folder.
        const cloudFolderId =
          !inFolder && space
            ? get().folders.find((f) => f.spaceId === space.id && f.scope === 'personal')?.id ?? folderId
            : folderId
        const doc: Doc = {
          id,
          title,
          emoji: kind === 'page' ? '🗒️' : kind === 'slides' ? '📊' : '📄',
          kind,
          folderId: inFolder ? space!.id : cloudFolderId,
          blocks: [{ id: uid('b'), type: 'heading', level: 1, html: title }],
          visibility: 'private',
          localPath: inFolder
            ? `${space!.mountPath ?? '~'}/${fileName}`
            : `~/Wordspace/我的草稿/${title}.html`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        // In a connected folder the new doc is a real .html file in that folder,
        // so it shows up in the file tree; in a cloud space it is just a document.
        if (inFolder) {
          const file: FileEntry = { spaceId: space!.id, path: fileName, kind: 'html', docId: id }
          set((s) => ({ docs: [doc, ...s.docs], files: [...s.files, file] }))
          get().openFileTab(file)
        } else {
          set((s) => ({ docs: [doc, ...s.docs] }))
          get().openDoc(id)
        }
        return id
      },

      createFromTemplate: (templateId, folderId) => {
        const tpl = get().templates.find((t) => t.id === templateId)
        if (!tpl) return ''
        const id = uid('d')
        const space = get().spaces.find((sp) => sp.id === get().activeSpaceId)
        const inFolder = !!space && !isCloudStorage(space.storage)
        const fileName = inFolder ? uniqueFilePath(get().files, space!.id, tpl.name) : `${tpl.name}.html`
        const cloudFolderId =
          !inFolder && space
            ? get().folders.find((f) => f.spaceId === space.id && f.scope === 'personal')?.id ?? folderId
            : folderId
        const doc: Doc = {
          id,
          title: tpl.name,
          emoji: '📄',
          kind: tpl.kind,
          folderId: inFolder ? space!.id : cloudFolderId,
          blocks: tpl.blocks.map((b) => ({ ...b, id: uid('b') })),
          visibility: 'private',
          localPath: inFolder
            ? `${space!.mountPath ?? '~'}/${fileName}`
            : `~/Wordspace/我的草稿/${tpl.name}.html`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        if (inFolder) {
          const file: FileEntry = { spaceId: space!.id, path: fileName, kind: 'html', docId: id }
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

      generateDoc: async (prompt, folderId) => {
        set({ aiBusy: true })
        await sleep(1700)
        const id = uid('d')
        const title = prompt.slice(0, 18) || 'AI 生成的文档'
        const space = get().spaces.find((sp) => sp.id === get().activeSpaceId)
        const inFolder = !!space && !isCloudStorage(space.storage)
        const fileName = inFolder ? uniqueFilePath(get().files, space!.id, title) : `${title}.html`
        const cloudFolderId =
          !inFolder && space
            ? get().folders.find((f) => f.spaceId === space.id && f.scope === 'personal')?.id ?? folderId
            : folderId
        const doc: Doc = {
          id,
          title,
          emoji: '✨',
          kind: 'doc',
          folderId: inFolder ? space!.id : cloudFolderId,
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
            ? `${space!.mountPath ?? '~'}/${fileName}`
            : `~/Wordspace/我的草稿/${title}.html`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        if (inFolder) {
          const file: FileEntry = { spaceId: space!.id, path: fileName, kind: 'html', docId: id }
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
        spaces: s.spaces,
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
