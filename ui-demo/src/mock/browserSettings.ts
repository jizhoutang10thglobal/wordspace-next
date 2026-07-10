import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 浏览器设置（mock，持久化）：默认搜索引擎。影响地址栏/新标签页/右键「打一句话就搜」。
// 「主页」设置已删（Colin 2026-07-10 拍板：起始页本身就是主页，不做可配置主页）。
// demo 默认 glass（虚构引擎，结果页能在 demo 内渲染）；真 app 默认 Bing（拍板）。
export type EngineKey = 'glass' | 'bing' | 'google' | 'ddg'
export const SEARCH_ENGINES: Record<EngineKey, { name: string; url: string }> = {
  glass: { name: 'Glass 搜索', url: 'glass://search?q=%s' }, // ui-demo 自带的可渲染搜索页
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  ddg: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
}

interface BsState {
  engine: EngineKey
  setEngine: (e: EngineKey) => void
  searchUrl: (q: string) => string
}

export const useBrowserSettings = create<BsState>()(
  persist(
    (set, get) => ({
      engine: 'glass',
      setEngine: (engine) => set({ engine }),
      searchUrl: (q) => SEARCH_ENGINES[get().engine].url.replace('%s', encodeURIComponent(q)),
    }),
    { name: 'wordspace-browser-settings' },
  ),
)
