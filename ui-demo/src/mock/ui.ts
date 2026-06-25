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
  openCreate: (targetDir?: string | null) => void
  closeCreate: () => void

  spaceModalOpen: boolean
  openSpaceModal: () => void
  closeSpaceModal: () => void

  sidebarCollapsed: boolean
  toggleSidebar: () => void

  // collapsed sidebar folders, keyed by 'folder:<id>' or 'tree:<path>'.
  collapsedKeys: Record<string, boolean>
  toggleCollapsed: (key: string) => void

  aiPrompt: string
  setAiPrompt: (v: string) => void
}

export const useUI = create<UI>((set) => ({
  publishDocId: null,
  openPublish: (docId) => set({ publishDocId: docId }),
  closePublish: () => set({ publishDocId: null }),

  createOpen: false,
  createTargetDir: null,
  openCreate: (targetDir = null) => set({ createOpen: true, createTargetDir: targetDir }),
  closeCreate: () => set({ createOpen: false }),

  spaceModalOpen: false,
  openSpaceModal: () => set({ spaceModalOpen: true }),
  closeSpaceModal: () => set({ spaceModalOpen: false }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  collapsedKeys: {},
  toggleCollapsed: (key) =>
    set((s) => ({ collapsedKeys: { ...s.collapsedKeys, [key]: !s.collapsedKeys[key] } })),

  aiPrompt: '',
  setAiPrompt: (v) => set({ aiPrompt: v }),
}))
