import { create } from 'zustand'

// Ephemeral, non-persisted UI state shared across feature modules
// (which dialog/menu is open). Data lives in store.ts; this is just chrome.
interface UI {
  publishDocId: string | null
  openPublish: (docId: string) => void
  closePublish: () => void

  createOpen: boolean
  // which (root, subfolder) the new doc should land in; null = space default (第一个根的根目录 / 我的草稿)
  createTarget: { rootId: string; dir: string } | null
  // omni = 从「标签页 +」打开：modal 顶部带一条地址栏（输网址→开网页标签页），下面接新建文档。
  // false = 从文件夹「+」/右键打开：只有新建文档选择器，建到 createTarget。
  createOmni: boolean
  openCreate: (target?: { rootId: string; dir: string } | null) => void
  openNewTab: () => void
  closeCreate: () => void

  // 「添加文件夹」modal（多文件夹：再打开一个根，和现有的并排）
  addFolderOpen: boolean
  openAddFolder: () => void
  closeAddFolder: () => void

  // 「保存到哪里」modal：临时文档手动保存时弹出选位置（默认当前文件夹）。
  saveDocId: string | null
  // 保存成功后要顺手关闭的标签页（来自「未保存关闭确认」的「保存并关闭」）；null = 只保存
  saveCloseAfterTab: string | null
  openSave: (docId: string, closeAfterTab?: string | null) => void
  closeSave: () => void

  // 未保存关闭确认：关标签页 / 关 Wordspace 时若有未保存文档 → 弹确认（切换标签页不弹）。
  confirmCloseTab: string | null
  askCloseTab: (tabId: string) => void
  cancelCloseTab: () => void

  // 查找文件面板（Cmd+P）
  findOpen: boolean
  openFind: () => void
  closeFind: () => void
  docFindOpen: boolean // 文档内查找条（Cmd+F）——非模态、不进 anyOverlayOpen
  openDocFind: () => void
  closeDocFind: () => void

  // 快捷键速查面板（Cmd+/ 或左下角 ⌨）
  shortcutsOpen: boolean
  openShortcuts: () => void
  closeShortcuts: () => void

  // AI 接入（浮动 modal，从左下角 AI 图标打开）
  agentsOpen: boolean
  openAgents: () => void
  closeAgents: () => void

  sidebarCollapsed: boolean
  toggleSidebar: () => void

  // collapsed sidebar folders, keyed by 'folder:<id>' / 'file:<rootId>:<path>' / 'root:<rootId>'.
  collapsedKeys: Record<string, boolean>
  toggleCollapsed: (key: string) => void
  // 展开（取消折叠）某个根下的一批文件夹路径，让某个文件在树里可见（F6：点标签页定位到文件）
  revealFolders: (rootId: string, paths: string[]) => void

  // Markdown 源码面板：markdown-backed 文档可开一条实时源码栏（blocksToMd），证明后端是 .md + round-trip。
  mdSourceOpen: boolean
  toggleMdSource: () => void
  setMdSource: (open: boolean) => void

  aiPrompt: string
  setAiPrompt: (v: string) => void
}

export const useUI = create<UI>((set) => ({
  publishDocId: null,
  openPublish: (docId) => set({ publishDocId: docId }),
  closePublish: () => set({ publishDocId: null }),

  createOpen: false,
  createTarget: null,
  createOmni: false,
  openCreate: (target = null) => set({ createOpen: true, createTarget: target, createOmni: false }),
  openNewTab: () => set({ createOpen: true, createTarget: null, createOmni: true }),
  closeCreate: () => set({ createOpen: false }),

  addFolderOpen: false,
  openAddFolder: () => set({ addFolderOpen: true }),
  closeAddFolder: () => set({ addFolderOpen: false }),

  saveDocId: null,
  saveCloseAfterTab: null,
  openSave: (docId, closeAfterTab = null) => set({ saveDocId: docId, saveCloseAfterTab: closeAfterTab }),
  closeSave: () => set({ saveDocId: null, saveCloseAfterTab: null }),

  confirmCloseTab: null,
  askCloseTab: (tabId) => set({ confirmCloseTab: tabId }),
  cancelCloseTab: () => set({ confirmCloseTab: null }),

  findOpen: false,
  openFind: () => set({ findOpen: true }),
  closeFind: () => set({ findOpen: false }),
  docFindOpen: false,
  openDocFind: () => set({ docFindOpen: true }),
  closeDocFind: () => set({ docFindOpen: false }),

  shortcutsOpen: false,
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),

  agentsOpen: false,
  openAgents: () => set({ agentsOpen: true }),
  closeAgents: () => set({ agentsOpen: false }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  collapsedKeys: {},
  toggleCollapsed: (key) =>
    set((s) => ({ collapsedKeys: { ...s.collapsedKeys, [key]: !s.collapsedKeys[key] } })),
  revealFolders: (rootId, paths) =>
    set((s) => {
      const m = { ...s.collapsedKeys }
      m['root:' + rootId] = false // 根自己也要是展开的
      for (const p of paths) m[`file:${rootId}:${p}`] = false
      return { collapsedKeys: m }
    }),

  mdSourceOpen: false,
  toggleMdSource: () => set((s) => ({ mdSourceOpen: !s.mdSourceOpen })),
  setMdSource: (open) => set({ mdSourceOpen: open }),

  aiPrompt: '',
  setAiPrompt: (v) => set({ aiPrompt: v }),
}))

/**
 * 有任何弹层（modal / 面板 / 确认框）开着吗？——快捷键派发的「弹层最优先」原则：
 * 弹层开着时，全局壳快捷键与编辑器快捷键都不得穿透执行（Esc/Enter/↑↓ 归弹层自己）。
 * mdSourceOpen 是常驻侧面板不是弹层，不算。
 */
export function anyOverlayOpen(s: UI): boolean {
  return !!(
    s.createOpen ||
    s.addFolderOpen ||
    s.saveDocId ||
    s.confirmCloseTab ||
    s.findOpen ||
    s.shortcutsOpen ||
    s.agentsOpen || // 「AI 接入」是全屏 modal，开着时壳/编辑器快捷键不该穿透（docFindOpen 是非模态查找条，有意不加）
    s.publishDocId
  )
}
