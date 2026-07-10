import { create } from 'zustand'
import { useStore } from './store'
import type { Tab } from '../types'

// ---------------------------------------------------------------------------
// 文档区导航历史（back / forward）。文档互链上线后需要「点错链接能回到上一篇」。
// 这是一套 app 级的单栈：past / current / future，元素是内容的**持久身份**（不是 tabId——
// 标签会去重复用/关闭，tabId 易失）。工作区内文件用 (rootId, path)，云端/临时文档用 docId。
//
// 本期只覆盖「文档/文件」导航（Colin 2026-07-09：先不管浏览器部分，它还在未合的 worktree）。
// 'web' 变体预留——将来浏览器 feature 合并时，网页导航 push 进同一个栈，就自然统一成一套 back/forward，
// 历史内核（push/back/forward/去重/身份）一行不用改。
// ---------------------------------------------------------------------------

export type NavEntry =
  | { kind: 'doc'; docId: string }
  | { kind: 'file'; rootId: string; path: string }
// | { kind: 'web'; url: string }   ← 预留：浏览器合并后加这一变体 + 一个 push 入口即统一

function entryFromTab(tab: Tab | undefined): NavEntry | null {
  if (!tab) return null
  // 连接文件夹里的文件（含可编辑 html/md）用文件身份——改名/移动后仍能按 (rootId, path) 找回
  if (tab.fileName && tab.rootId) return { kind: 'file', rootId: tab.rootId, path: tab.url }
  if (tab.docId) return { kind: 'doc', docId: tab.docId }
  return null // 网页标签：本期不进文档历史
}

function sameEntry(a: NavEntry | null, b: NavEntry): boolean {
  if (!a || a.kind !== b.kind) return false
  if (a.kind === 'doc' && b.kind === 'doc') return a.docId === b.docId
  if (a.kind === 'file' && b.kind === 'file') return a.rootId === b.rootId && a.path === b.path
  return false
}

interface NavState {
  past: NavEntry[]
  current: NavEntry | null
  future: NavEntry[]
  applying: boolean // back/forward 触发的重放期间为 true——抑制订阅把这次跳转再 push 回去
  back: () => void
  forward: () => void
}

function seedCurrent(): NavEntry | null {
  const st = useStore.getState()
  return entryFromTab(st.tabs.find((t) => t.id === st.activeTabId))
}

// 真正「去那里」：按身份重新打开/激活对应内容。目标已删/移动则提示并停在原地。
function apply(entry: NavEntry) {
  const st = useStore.getState()
  if (entry.kind === 'doc') {
    if (st.getDoc(entry.docId)) st.openDoc(entry.docId)
    else st.toast('该文档已删除', 'danger')
  } else {
    const file = st.files.find((f) => f.rootId === entry.rootId && f.path === entry.path)
    if (file) st.openFileTab(file)
    else st.toast('该文件已移动或删除', 'danger')
  }
}

export const useNav = create<NavState>()((set, get) => ({
  past: [],
  current: seedCurrent(),
  future: [],
  applying: false,

  back: () => {
    const s = get()
    if (!s.current || s.past.length === 0) return
    const prev = s.past[s.past.length - 1]
    set({ past: s.past.slice(0, -1), current: prev, future: [s.current, ...s.future], applying: true })
    apply(prev)
    set({ applying: false })
  },

  forward: () => {
    const s = get()
    if (!s.current || s.future.length === 0) return
    const next = s.future[0]
    set({ past: [...s.past, s.current], current: next, future: s.future.slice(1), applying: true })
    apply(next)
    set({ applying: false })
  },
}))

// 「当前活动内容变了」= 一次文档导航。openDoc / openFileTab（点链接、点文件树、@导航）、切标签、
// 关标签回落——全都改 activeTabId，这里统一捕获 → push。back/forward 自己触发的那次 apply 期间 applying=true，跳过。
let lastActive = useStore.getState().activeTabId
const unsub = useStore.subscribe((state) => {
  if (state.activeTabId === lastActive) return
  lastActive = state.activeTabId
  const nav = useNav.getState()
  if (nav.applying) return
  const entry = entryFromTab(state.tabs.find((t) => t.id === state.activeTabId))
  if (!entry) return // 切到网页标签：本期不进文档历史（将来统一）
  if (sameEntry(nav.current, entry)) return
  useNav.setState({
    past: nav.current ? [...nav.past, nav.current] : nav.past,
    current: entry,
    future: [],
  })
})

// Vite HMR：热更新重载本模块时清掉旧订阅，别叠加（dev-only）
if (import.meta.hot) {
  import.meta.hot.dispose(() => unsub())
}
