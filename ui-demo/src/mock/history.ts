import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 浏览历史（mock，无后端，localStorage）。记每次访问(带时间戳),历史页按日期分组;
// 支持删除单条 + 按时间段清空(隐私)。地址栏自动补全也从这里取数据。
export interface HistEntry {
  id: string
  url: string
  title: string
  visitedAt: number // ms
  favicon?: string
}

const uid = () => `h-${Math.random().toString(36).slice(2, 9)}`
const CAP = 500
const HOUR = 3600_000
const DAY = 24 * HOUR

// 只记 http(s)/mock 站(glass:// 搜索页也记,方便补全);wordspace://newtab 不记。
function recordable(url: string): boolean {
  return /^https?:/i.test(url) || url.startsWith('glass://search')
}

// seed 几条(相对"现在"往前推),让历史页一开就有内容。用固定基准,持久化后不乱跳。
const NOW = 1_720_500_000_000
// i18n-exempt-start —— 种子历史条目（假访问记录），演示数据不翻。
const seed: HistEntry[] = [
  { id: 'hs1', url: 'https://news.design/today', title: 'Designer News · 行业动态', visitedAt: NOW - 20 * 60_000 },
  { id: 'hs2', url: 'https://tenthglobal.com', title: 'Tenth Global', visitedAt: NOW - 2 * HOUR },
  { id: 'hs3', url: 'https://flowdesk.app', title: 'FlowDesk', visitedAt: NOW - 5 * HOUR },
  { id: 'hs4', url: 'glass://search?q=本地优先软件', title: '本地优先软件 - Glass 搜索', visitedAt: NOW - DAY - HOUR },
  { id: 'hs5', url: 'https://news.design/today', title: 'Designer News · 行业动态', visitedAt: NOW - 2 * DAY },
]
// i18n-exempt-end

interface HistState {
  entries: HistEntry[]
  record: (url: string, title: string, favicon?: string) => void
  removeOne: (id: string) => void
  clear: (range?: 'hour' | 'day' | 'week' | 'all') => void
  search: (q: string, limit?: number) => HistEntry[]
}

export const useHistory = create<HistState>()(
  persist(
    (set, get) => ({
      entries: seed,
      record: (url, title, favicon) => {
        if (!recordable(url)) return
        set((s) => {
          // 同 url 连续访问不重复堆(1 分钟内视为同一次);否则记新访问
          const last = s.entries[0]
          const now = Date.now()
          if (last && last.url === url && now - last.visitedAt < 60_000) {
            return { entries: [{ ...last, title: title || last.title, visitedAt: now }, ...s.entries.slice(1)] }
          }
          const next = [{ id: uid(), url, title: title || url, visitedAt: now, favicon }, ...s.entries]
          return { entries: next.slice(0, CAP) }
        })
      },
      removeOne: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clear: (range = 'all') => {
        if (range === 'all') { set({ entries: [] }); return }
        const cutoff = Date.now() - (range === 'hour' ? HOUR : range === 'day' ? DAY : 7 * DAY)
        set((s) => ({ entries: s.entries.filter((e) => e.visitedAt < cutoff) }))
      },
      search: (q, limit = 8) => {
        const t = q.trim().toLowerCase()
        if (!t) return []
        const seen = new Set<string>()
        const out: HistEntry[] = []
        for (const e of get().entries) {
          if (seen.has(e.url)) continue // 补全用:同 url 只出一次(最近的)
          if (e.title.toLowerCase().includes(t) || e.url.toLowerCase().includes(t)) { out.push(e); seen.add(e.url) }
          if (out.length >= limit) break
        }
        return out
      },
    }),
    { name: 'wordspace-history' },
  ),
)
