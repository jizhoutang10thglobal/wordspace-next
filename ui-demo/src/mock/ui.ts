import { create } from 'zustand'

// Ephemeral, non-persisted UI state shared across feature modules
// (which dialog/menu is open). Data lives in store.ts; this is just chrome.
interface UI {
  publishDocId: string | null
  openPublish: (docId: string) => void
  closePublish: () => void

  createOpen: boolean
  openCreate: () => void
  closeCreate: () => void

  aiPrompt: string
  setAiPrompt: (v: string) => void
}

export const useUI = create<UI>((set) => ({
  publishDocId: null,
  openPublish: (docId) => set({ publishDocId: docId }),
  closePublish: () => set({ publishDocId: null }),

  createOpen: false,
  openCreate: () => set({ createOpen: true }),
  closeCreate: () => set({ createOpen: false }),

  aiPrompt: '',
  setAiPrompt: (v) => set({ aiPrompt: v }),
}))
