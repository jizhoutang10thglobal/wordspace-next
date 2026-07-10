import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 浏览器设置（mock，持久化）：默认搜索引擎 + 主页。搜索引擎影响地址栏「打一句话就搜」。
export type EngineKey = 'glass' | 'bing' | 'google' | 'ddg'
export const SEARCH_ENGINES: Record<EngineKey, { name: string; url: string }> = {
  glass: { name: 'Glass 搜索', url: 'glass://search?q=%s' }, // ui-demo 自带的可渲染搜索页
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
}

interface BsState {
  engine: EngineKey
  homepage: string
  setEngine: (e: EngineKey) => void
  setHomepage: (h: string) => void
  searchUrl: (q: string) => string
}

export const useBrowserSettings = create<BsState>()(
  persist(
    (set, get) => ({
      engine: 'glass',
      homepage: 'wordspace://newtab',
      setEngine: (engine) => set({ engine }),
      setHomepage: (homepage) => set({ homepage: homepage.trim() || 'wordspace://newtab' }),
      searchUrl: (q) => SEARCH_ENGINES[get().engine].url.replace('%s', encodeURIComponent(q)),
    }),
    { name: 'wordspace-browser-settings' },
  ),
)
