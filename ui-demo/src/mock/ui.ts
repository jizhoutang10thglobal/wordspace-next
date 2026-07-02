import { create } from 'zustand'

// Ephemeral, non-persisted UI state shared across feature modules
// (which dialog/menu is open). Data lives in store.ts; this is just chrome.
interface UI {
  publishDocId: string | null
  openPublish: (docId: string) => void
  closePublish: () => void

  createOpen: boolean
  // which connected-folder subfolder the new doc should land in; null = space default (root / 我的草稿)
  createTargetDir: string | null
  // omni = 从「标签页 +」打开：modal 顶部带一条地址栏（输网址→开网页标签页），下面接新建文档。
  // false = 从文件夹「+」/右键打开：只有新建文档选择器，建到 createTargetDir。
  createOmni: boolean
  openCreate: (targetDir?: string | null) => void
  openNewTab: () => void
  closeCreate: () => void

  spaceModalOpen: boolean
  openSpaceModal: () => void
  closeSpaceModal: () => void

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

  sidebarCollapsed: boolean
  toggleSidebar: () => void

  // collapsed sidebar folders, keyed by 'folder:<id>' or 'tree:<path>'.
  collapsedKeys: Record<string, boolean>
  toggleCollapsed: (key: string) => void
  // 展开（取消折叠）一批文件夹路径，让某个文件在树里可见（F6：点标签页定位到文件）
  revealFolders: (paths: string[]) => void

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
  createTargetDir: null,
  createOmni: false,
  openCreate: (targetDir = null) => set({ createOpen: true, createTargetDir: targetDir, createOmni: false }),
  openNewTab: () => set({ createOpen: true, createTargetDir: null, createOmni: true }),
  closeCreate: () => set({ createOpen: false }),

  spaceModalOpen: false,
  openSpaceModal: () => set({ spaceModalOpen: true }),
  closeSpaceModal: () => set({ spaceModalOpen: false }),

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

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  collapsedKeys: {},
  toggleCollapsed: (key) =>
    set((s) => ({ collapsedKeys: { ...s.collapsedKeys, [key]: !s.collapsedKeys[key] } })),
  revealFolders: (paths) =>
    set((s) => {
      const m = { ...s.collapsedKeys }
      for (const p of paths) m['file:' + p] = false
      return { collapsedKeys: m }
    }),

  mdSourceOpen: false,
  toggleMdSource: () => set((s) => ({ mdSourceOpen: !s.mdSourceOpen })),
  setMdSource: (open) => set({ mdSourceOpen: open }),

  aiPrompt: '',
  setAiPrompt: (v) => set({ aiPrompt: v }),
}))
