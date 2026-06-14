import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AgentEvent,
  Block,
  BlockType,
  Doc,
  DocKind,
  Folder,
  Member,
  Presence,
  Space,
  Tab,
  Template,
  Toast,
  Visibility,
  Workspace,
} from '../types'
import {
  ME_ID,
  seedAgentEvents,
  seedDocs,
  seedFolders,
  seedMembers,
  seedSpaces,
  seedTemplates,
  seedWorkspace,
} from './seed'

// Bump when the shape of seed data changes so a reload reseeds cleanly.
const SEED_VERSION = 4

const uid = (p = 'id') =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

  // transient ui (not persisted)
  meId: string
  activeSpaceId: string
  tabs: Tab[]
  activeTabId: string
  toasts: Toast[]
  presence: Presence[]
  aiBusy: boolean

  // selectors
  getDoc: (id: string) => Doc | undefined
  getMember: (id: string) => Member | undefined

  // tabs + spaces
  openDoc: (docId: string) => void
  openWebTab: (url: string, title: string) => void
  newBrowserTab: () => void
  setTabUrl: (tabId: string, url: string, title?: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setActiveSpace: (spaceId: string) => void

  // editing
  updateBlockHtml: (docId: string, blockId: string, html: string) => void
  reorderBlocks: (docId: string, from: number, to: number) => void
  addBlock: (docId: string, afterId: string | null, type: BlockType) => string
  deleteBlock: (docId: string, blockId: string) => void

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
        {
          id: 'tab-1',
          docId: 'd-handbook',
          kind: 'doc',
          title: '员工手册',
          url: 'https://team.tenthglobal.com/handbook',
        },
        {
          id: 'tab-web',
          kind: 'web',
          title: 'Designer News · 行业动态',
          url: 'https://news.design/today',
        },
      ],
      activeTabId: 'tab-1',
      toasts: [],
      presence: [],
      aiBusy: false,

      getDoc: (id) => get().docs.find((d) => d.id === id),
      getMember: (id) => get().members.find((m) => m.id === id),

      openDoc: (docId) => {
        const doc = get().getDoc(docId)
        if (!doc) return
        const existing = get().tabs.find((t) => t.docId === docId)
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

      setActiveSpace: (spaceId) => set({ activeSpaceId: spaceId }),

      closeTab: (tabId) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== tabId)
          let activeTabId = s.activeTabId
          if (activeTabId === tabId)
            activeTabId = tabs[tabs.length - 1]?.id ?? ''
          return { tabs, activeTabId }
        }),

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

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

      createDoc: (folderId, kind = 'doc', title = '无标题文档') => {
        const id = uid('d')
        const doc: Doc = {
          id,
          title,
          emoji: kind === 'page' ? '🗒️' : kind === 'slides' ? '📊' : '📄',
          kind,
          folderId,
          blocks: [{ id: uid('b'), type: 'heading', level: 1, html: title }],
          visibility: 'private',
          localPath: `~/Wordspace/我的草稿/${title}.html`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        set((s) => ({ docs: [doc, ...s.docs] }))
        get().openDoc(id)
        return id
      },

      createFromTemplate: (templateId, folderId) => {
        const tpl = get().templates.find((t) => t.id === templateId)
        if (!tpl) return ''
        const id = uid('d')
        const doc: Doc = {
          id,
          title: tpl.name,
          emoji: '📄',
          kind: tpl.kind,
          folderId,
          blocks: tpl.blocks.map((b) => ({ ...b, id: uid('b') })),
          visibility: 'private',
          localPath: `~/Wordspace/我的草稿/${tpl.name}.html`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        set((s) => ({ docs: [doc, ...s.docs] }))
        get().openDoc(id)
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
        })),

      generateDoc: async (prompt, folderId) => {
        set({ aiBusy: true })
        await sleep(1700)
        const id = uid('d')
        const title = prompt.slice(0, 18) || 'AI 生成的文档'
        const doc: Doc = {
          id,
          title,
          emoji: '✨',
          kind: 'doc',
          folderId,
          blocks: [
            { id: uid('b'), type: 'heading', level: 1, html: title },
            { id: uid('b'), type: 'text', html: '这是 Wordspace 根据你的描述生成的初稿。下面的结构和文字都可以直接改,或再让 AI 调整。' },
            { id: uid('b'), type: 'heading', level: 2, html: '背景' },
            { id: uid('b'), type: 'text', html: '根据「' + prompt + '」整理的要点。' },
            { id: uid('b'), type: 'list', html: '<li>第一点</li><li>第二点</li><li>第三点</li>' },
            { id: uid('b'), type: 'callout', html: '需要更正式的版式,可以让 AI 把某一段做成带设计的区域。' },
          ],
          visibility: 'private',
          localPath: `~/Wordspace/我的草稿/${title}.html`,
          updatedAt: Date.now(),
          updatedBy: get().meId,
          collaborators: [get().meId],
        }
        set((s) => ({ docs: [doc, ...s.docs], aiBusy: false }))
        get().openDoc(id)
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
      }),
      migrate: () => ({ ...freshData() }) as never,
    },
  ),
)

// expose a reset for development / kiosk reset
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__resetWordspace = () => {
    localStorage.removeItem('wordspace-demo')
    location.reload()
  }
}
