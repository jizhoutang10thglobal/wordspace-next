import { create } from 'zustand'
import { DEFAULT_PAGE_CONFIG, type PageConfig } from '../lib/page'

// ============================================================================
// 每文档「分页文档」配置：按 doc id 存 localStorage（独立于主 store 的 persist，
// 语义对齐真 app 的「页面声明入盘」——demo 里 localStorage 就是那份盘）。
// ============================================================================

const LS_KEY = 'ws-paged-docs'

function load(): Record<string, PageConfig> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, PageConfig>) : {}
  } catch {
    return {}
  }
}

interface PagedState {
  configs: Record<string, PageConfig>
  getConfig: (docId: string) => PageConfig
  setConfig: (docId: string, cfg: PageConfig) => void
}

export const usePaged = create<PagedState>()((set, get) => ({
  configs: load(),
  getConfig: (docId) => get().configs[docId] ?? DEFAULT_PAGE_CONFIG,
  setConfig: (docId, cfg) => {
    const configs = { ...get().configs, [docId]: cfg }
    set({ configs })
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(configs))
    } catch {
      // localStorage 满/禁用：demo 里静默，配置退化为会话内有效
    }
  },
}))

/** 取某文档配置的 hook（组件里用；默认关闭）。 */
export const usePageConfig = (docId: string | undefined): PageConfig =>
  usePaged((s) => (docId ? (s.configs[docId] ?? DEFAULT_PAGE_CONFIG) : DEFAULT_PAGE_CONFIG))
