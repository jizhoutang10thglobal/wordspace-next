import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  uniquify,
  stripUniquifySuffix,
  isTerminal,
  canRetry,
  type DownloadState,
} from '../lib/downloads'

// 下载记录 + 假进度引擎（mock：无真网络、无真落盘，进度是定时器）。照 history.ts 的
// zustand persist 形状。两条 KTD 在这兑现：
// ① 引擎放模块级（定时器不挂组件）——关掉来源标签/切去文档标签，下载照走；组件卸载杀定时器
//    是 React 最易犯的错，这里从结构上杜绝。
// ② 刷新页面 = mock 的「退出 app」：persist 的 rehydrate 钩子（merge，见下）把一切
//    downloading → interrupted（R4/AE2）——定时器随页面死掉，重进不会有僵尸进度。

export interface DownloadEntry {
  id: string
  filename: string // 最终显示名（开始那刻已 uniquify）
  sourceUrl: string
  sizeBytes: number
  receivedBytes: number
  state: DownloadState
  startedAt: number
  durationMs: number // mock：假下载走完全程的时长档（普通 ~6s / 大文件 ~30s）
  failAt?: number // mock：确定性失败触发点（0..1 比例）；进度到这里转 failed
}

export interface DownloadSpec {
  filename: string
  sourceUrl: string
  sizeBytes: number
  durationMs: number
  failAt?: number
}

const uid = () => `dl-${Math.random().toString(36).slice(2, 9)}`
const CAP = 100
const TICK_MS = 120
const HOUR = 3600_000
// 固定基准（同 history.ts 先例）：seed 时间持久化后不乱跳。
const NOW = 1_720_500_000_000

// i18n-exempt-start —— 种子下载记录（演示数据）：1 条完成 + 1 条「文件已被删除」演示置灰态；文件名不翻。
const seedEntries: DownloadEntry[] = [
  {
    id: 'dls1',
    filename: '品牌视觉规范 v3.pdf',
    sourceUrl: 'https://tenthglobal.com/brand/guide.pdf',
    sizeBytes: 4_823_449,
    receivedBytes: 4_823_449,
    state: 'completed',
    startedAt: NOW - 2 * HOUR,
    durationMs: 6000,
  },
  {
    id: 'dls2',
    filename: '团队合影 2026.jpg',
    sourceUrl: 'https://news.design/img/team.jpg',
    sizeBytes: 2_306_867,
    receivedBytes: 2_306_867,
    state: 'fileMissing',
    startedAt: NOW - 26 * HOUR,
    durationMs: 6000,
  },
]
// fileMissing 那条的文件已不在磁盘上 → 不占名；只有 completed 的进 diskNames。
const seedDiskNames = ['品牌视觉规范 v3.pdf']
// i18n-exempt-end

interface DlState {
  entries: DownloadEntry[]
  // 「磁盘上已有哪些文件名」的隐藏集合（R2+R9 叠加坑）：完成即落账，清空记录**不清它**——
  // 否则清空后再下同名文件会退回原名 = 语义上覆盖了还在磁盘上的文件。
  diskNames: string[]
  // 当前批次（进度环口径）：在途 + 本批内已完成的条目 id。不持久；全部落地后清空。
  batchIds: string[]
  startDownload: (spec: DownloadSpec) => string
  cancelDownload: (id: string) => void
  retryDownload: (id: string) => void
  removeOne: (id: string) => void
  clearRecords: () => void
}

// —— 假进度引擎（模块级，不挂任何组件）——
const timers = new Map<string, ReturnType<typeof setInterval>>()

function stopTicker(id: string) {
  const tm = timers.get(id)
  if (tm) {
    clearInterval(tm)
    timers.delete(id)
  }
}

function beginTicker(id: string) {
  stopTicker(id)
  timers.set(
    id,
    setInterval(() => {
      const s = useDownloads.getState()
      const e = s.entries.find((x) => x.id === id)
      if (!e || e.state !== 'downloading') {
        stopTicker(id)
        return
      }
      const next = e.receivedBytes + e.sizeBytes * (TICK_MS / e.durationMs)
      if (e.failAt != null && next >= e.sizeBytes * e.failAt) {
        stopTicker(id)
        finishAs(id, 'failed', Math.round(e.sizeBytes * e.failAt))
      } else if (next >= e.sizeBytes) {
        stopTicker(id)
        finishAs(id, 'completed', e.sizeBytes)
      } else {
        // 进度 tick 只改这一条的 receivedBytes（React 按 key 复用行 DOM，只更新数字/环，不整卡重建）。
        useDownloads.setState((st) => ({
          entries: st.entries.map((x) => (x.id === id ? { ...x, receivedBytes: Math.round(next) } : x)),
        }))
      }
    }, TICK_MS),
  )
}

// 终态迁移统一收口：批次维护（cancel/fail 退出批次、completed 留在批内撑住环；无在途 → 批次清空）
// + completed 落账 diskNames。
function finishAs(id: string, state: 'failed' | 'completed' | 'canceled', receivedBytes: number) {
  useDownloads.setState((st) => {
    const entries = st.entries.map((x) => (x.id === id ? { ...x, receivedBytes, state } : x))
    let batchIds = state === 'completed' ? st.batchIds : st.batchIds.filter((b) => b !== id)
    if (!entries.some((e) => e.state === 'downloading')) batchIds = []
    const name = entries.find((e) => e.id === id)?.filename
    const diskNames =
      state === 'completed' && name && !st.diskNames.includes(name)
        ? [...st.diskNames, name]
        : st.diskNames
    return { entries, batchIds, diskNames }
  })
}

// CAP 裁剪：超上限时从最老端挤掉**终态**条目；在途绝不挤。
function capped(entries: DownloadEntry[]): DownloadEntry[] {
  if (entries.length <= CAP) return entries
  const out = [...entries]
  for (let i = out.length - 1; i >= 0 && out.length > CAP; i--) {
    if (isTerminal(out[i].state)) out.splice(i, 1)
  }
  return out
}

export const useDownloads = create<DlState>()(
  persist(
    (set, get) => ({
      entries: seedEntries,
      diskNames: seedDiskNames,
      batchIds: [],

      startDownload: (spec) => {
        const s = get()
        // 查重口径：磁盘隐藏集合 ∪ 在途名（AE1：同名二连下，第二条开始那刻就叫 (1)）。
        // failed/canceled/interrupted 不占名——它们没在磁盘留下文件（F3：不留半截文件）。
        const taken = new Set([
          ...s.diskNames,
          ...s.entries.filter((e) => e.state === 'downloading').map((e) => e.filename),
        ])
        const filename = uniquify(spec.filename, taken)
        const id = uid()
        const entry: DownloadEntry = {
          id,
          filename,
          sourceUrl: spec.sourceUrl,
          sizeBytes: spec.sizeBytes,
          receivedBytes: 0,
          state: 'downloading',
          startedAt: Date.now(),
          durationMs: spec.durationMs,
          failAt: spec.failAt,
        }
        set((st) => ({ entries: capped([entry, ...st.entries]), batchIds: [...st.batchIds, id] }))
        beginTicker(id)
        return id
      },

      cancelDownload: (id) => {
        const e = get().entries.find((x) => x.id === id)
        if (!e || e.state !== 'downloading') return
        stopTicker(id)
        finishAs(id, 'canceled', e.receivedBytes)
      },

      // 重试 = 新条目置顶重下（KTD，Chrome 同款）：剥掉一层 (n) 后缀拿回原始请求名，
      // 再走一遍 uniquify（原名若已落盘会拿到新后缀）。原条目原地不动。
      retryDownload: (id) => {
        const e = get().entries.find((x) => x.id === id)
        if (!e || !canRetry(e.state)) return
        get().startDownload({
          filename: stripUniquifySuffix(e.filename),
          sourceUrl: e.sourceUrl,
          sizeBytes: e.sizeBytes,
          durationMs: e.durationMs,
          failAt: e.failAt,
        })
      },

      removeOne: (id) =>
        set((st) => ({
          entries: st.entries.filter((e) => !(e.id === id && isTerminal(e.state))),
          batchIds: st.batchIds.filter((b) => b !== id),
        })),

      // 清空只清终态记录；在途保留；diskNames 刻意不动（见字段注释）。
      clearRecords: () =>
        set((st) => ({ entries: st.entries.filter((e) => e.state === 'downloading') })),
    }),
    {
      name: 'wordspace-downloads',
      partialize: (s) => ({ entries: s.entries, diskNames: s.diskNames }),
      // rehydrate 钩子：在 merge 这一步做 downloading → interrupted（而不是 onRehydrateStorage 的
      // 事后回调）——merge 的返回值会被原子地 set 进 store 并立刻回写 localStorage，
      // 状态从不出现「刷新后还是 downloading」的窗口，也无需绕过通知机制去改已生效的 state。
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<DlState, 'entries' | 'diskNames'>>
        const entries = (p.entries ?? current.entries).map((e) =>
          e.state === 'downloading' ? { ...e, state: 'interrupted' as const } : e,
        )
        return { ...current, ...p, entries, batchIds: [] }
      },
    },
  ),
)

// 测试 seam（照 store.ts 的 __wsStore/__wsUI 惯例）。挂在本模块而不是 store.ts：
// 通知 toast 要求 downloads → store 的 import 方向（同 browser.ts 先例），若 store.ts 再反向
// import 本模块取 useDownloads，模块图先从 downloads 一侧进入时会撞 TDZ（const 未初始化）。
// 这里自挂，零循环依赖。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__wsDownloads = useDownloads
}
