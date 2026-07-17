// 快捷键教学气泡（Wendi 2026-07-16）：用户用鼠标做了某个有快捷键的操作时，弹一次 toast 顺手教一下
// 「下次可以按 ⌘X」。每个操作**一辈子只弹一次**（localStorage 记住），不烦人。只在鼠标触发时调——
// 键盘触发说明用户已经会了，不用教。
//
// 用法：在按钮的 onClick 里（做完真正的动作之后）调 coachOnce(toast, 'toggle-sidebar', '下次可以用 ⌘\\ 收起侧栏')。

const STORE_KEY = 'ws-coached-ops'

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

// tone 收窄成 'hint'（本模块只弹教学气泡）——store 的 toast(联合类型 tone) 可赋值给它，
// 避免 strictFunctionTypes 下「联合字面量 vs string」的逆变不匹配。
type ToastFn = (message: string, tone?: 'hint') => string

export function coachOnce(toast: ToastFn, op: string, message: string): void {
  const s = seen()
  if (s.has(op)) return // 教过了，永不再弹
  s.add(op)
  localStorage.setItem(STORE_KEY, JSON.stringify([...s]))
  toast(message, 'hint')
}

// 调试/演示用：清掉「已教过」记录，让气泡重新可弹（demo 页面的「重置」按钮可用）。
export function resetCoach(): void {
  localStorage.removeItem(STORE_KEY)
}
