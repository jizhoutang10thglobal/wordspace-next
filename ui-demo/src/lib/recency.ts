// 默认屏导览页(时间流)的分组纯函数:updatedAt → 今天/昨天/本周/更早。
// 独立成模块 = 可单测 + 真 app 移植直接搬(spec docs/features/start-page.md)。
export type RecencyGroup = 'today' | 'yesterday' | 'week' | 'earlier'

/** 本地日界(0 点)为准分组;未来时间容错归 today(时钟漂移/演示种子)。 */
export function groupKey(updatedAt: number, now: number = Date.now()): RecencyGroup {
  const d = new Date(now)
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (updatedAt >= todayStart) return 'today'
  const dayMs = 24 * 60 * 60 * 1000
  if (updatedAt >= todayStart - dayMs) return 'yesterday'
  if (updatedAt >= todayStart - 6 * dayMs) return 'week' // 昨天之前的最近 6 个日界内=本周档
  return 'earlier'
}

export const GROUP_ORDER: RecencyGroup[] = ['today', 'yesterday', 'week', 'earlier']

/** localPath(如 ~/Wordspace/团队/人事/员工手册.html)→ 所在文件夹名(人事);根下文件给 fallback。 */
export function folderLabel(localPath: string, fallback = ''): string {
  const segs = localPath.split('/').filter(Boolean)
  return segs.length >= 2 ? segs[segs.length - 2] : fallback
}
