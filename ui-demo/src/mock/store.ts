import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AgentEvent,
  Block,
  BlockType,
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
const SEED_VERSION = 7

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
  deleteFile: (file: FileEntry) => void
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
  addBlock: (docId: string, afterId: string | null, type: BlockType) => string
  deleteBlock: (docId: string, blockId: string) => void
  setBlockType: (
    docId: string,
    blockId: string,
    type: BlockType,
    level?: 1 | 2 | 3,
  ) => void
  duplicateBlock: (docId: string, blockId: string) => string

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
  toast: (message: string, tone?: Toast['tone']) => string
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
  }
}

const newBlock = (type: BlockType): Block => {
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
  return { id: uid('b'), type, ...base[type] } as Block
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...freshData(),

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
        const base = newBase.trim()
        if (!base) return
        const slash = file.path.lastIndexOf('/')
        const dir = slash >= 0 ? file.path.slice(0, slash + 1) : ''
        const dot = file.path.lastIndexOf('.')
        const ext = dot > slash ? file.path.slice(dot) : ''
        const newPath = `${dir}${base}${ext}`
        const newName = `${base}${ext}`
        if (newPath === file.path) return
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

      // Delete a file from a connected folder: drop its FileEntry, its open tab,
      // and (for HTML) the backing doc.
      deleteFile: (file) => {
        set((s) => ({
          docs: file.docId ? s.docs.filter((d) => d.id !== file.docId) : s.docs,
          files: s.files.filter(
            (f) => !(f.spaceId === file.spaceId && f.path === file.path),
          ),
          tabs: s.tabs.filter((t) =>
            t.fileName && t.spaceId === file.spaceId && t.url === file.path ? false : true,
          ),
        }))
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

      addBlock: (docId, afterId, type) => {
        const block = newBlock(type)
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
      setBlockType: (docId, blockId, type, level) =>
        set((s) => ({
          docs: s.docs.map((d) =>
            d.id !== docId
              ? d
              : {
                  ...d,
                  updatedAt: Date.now(),
                  updatedBy: s.meId,
                  blocks: d.blocks.map((b) =>
                    b.id !== blockId
                      ? b
                      : {
                          ...b,
                          type,
                          level:
                            type === 'heading'
                              ? level ?? b.level ?? 2
                              : undefined,
                        },
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

      toast: (message, tone = 'neutral') => {
        const id = uid('toast')
        set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }))
        if (tone !== 'progress')
          setTimeout(() => get().dismissToast(id), 2600)
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
