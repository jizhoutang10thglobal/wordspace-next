// 下载功能的纯逻辑（对齐真 app 纯逻辑模块的先例，如 webCtxMenu.ts——移植时整体搬，无 React/DOM/store 依赖）。
// 只放确定性函数：文件名去重(uniquify) / 中段截断 / 聚合进度 / 状态机判定 / URL 派生文件名 / 字节格式化。
// 假进度引擎、持久化、toast 在 mock/downloads.ts（那才是 mock 专属、真 app 会换成 Electron DownloadItem）。

export type DownloadState =
  | 'downloading'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'interrupted'
  | 'fileMissing'

// —— 状态机判定：逐状态操作集的单一真相源（UI 和 store 都读这几个，别各写各的）——
export const isTerminal = (s: DownloadState): boolean => s !== 'downloading'
// 失败 / 已取消 / 已中断可重试（= 新条目置顶重下，见 mock/downloads.ts retryDownload）。
export const canRetry = (s: DownloadState): boolean =>
  s === 'failed' || s === 'canceled' || s === 'interrupted'
// 仅完成态可「在访达中显示」。
export const canReveal = (s: DownloadState): boolean => s === 'completed'
// 进行中不可单条移除（只能取消）；其余终态都能移除。
export const canRemove = (s: DownloadState): boolean => s !== 'downloading'

/**
 * Chrome 式重名消歧：名字已被占用就在扩展名前插 ` (n)`。
 * `报告.pdf` → `报告 (1).pdf` → `报告 (2).pdf`；无扩展名 `foo` → `foo (1)`。
 * taken = 磁盘上已有的名字 ∪ 当前在途下载的名字（调用方组装），绝不覆盖已有文件。
 */
export function uniquify(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 1
  let candidate = `${base} (${n})${ext}`
  while (taken.has(candidate)) {
    n++
    candidate = `${base} (${n})${ext}`
  }
  return candidate
}

/**
 * 去掉一层 ` (n)` 消歧后缀，拿回原始请求名——重试时用它重走一遍 uniquify（否则会叠成 `x (1) (1)`）。
 * `报告 (1).pdf` → `报告.pdf`；`报告.pdf` → `报告.pdf`（无后缀原样返回）。
 */
export function stripUniquifySuffix(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const stripped = base.replace(/ \(\d+\)$/, '')
  return stripped + ext
}

/**
 * 中段截断长文件名：头部 + `…` + 尾部，尾部保住扩展名与 ` (n)` 后缀（两端都是用户认名字的关键信息）。
 * 按码点切（Array.from），不切断中文/emoji。整名 title 属性另给（这里只管显示串）。
 */
export function truncateMiddle(name: string, max = 34): string {
  const chars = Array.from(name)
  if (chars.length <= max) return name
  const tail = Math.max(10, Math.floor(max * 0.4))
  const head = Math.max(1, max - tail - 1)
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('')
}

/**
 * 聚合进度（工具栏进度环，P2）：对「当前批次」条目算 pct = Σ已收 / Σ总量。
 * 批次 = 在途 + 本批内已完成的条目（由 store 的 batchIds 圈定）——完成的留在分子分母里，
 * 单条先完成时环只前进不回退（Chrome 同款）；取消/失败的条目由 store 移出批次。
 * active = 在途条数（徽标数字）；active 为 0 = 批次结束，环隐藏。
 */
export function aggregateProgress(
  batch: { state: DownloadState; receivedBytes: number; sizeBytes: number }[],
): { active: number; pct: number } {
  const active = batch.filter((e) => e.state === 'downloading').length
  if (active === 0) return { active: 0, pct: 0 }
  const recv = batch.reduce((s, e) => s + e.receivedBytes, 0)
  const total = batch.reduce((s, e) => s + e.sizeBytes, 0)
  return { active, pct: total > 0 ? Math.min(1, recv / total) : 0 }
}

/**
 * 从 URL 的 path 段派生下载文件名（右键存图 / 链接另存为用）。
 * `https://news.design/img/hero.jpg` → `hero.jpg`；无 path 回落 host + 扩展名。
 */
export function filenameFromUrl(url: string, fallbackExt = ''): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last && /\.[a-z0-9]{1,8}$/i.test(last)) return decodeURIComponent(last)
    if (last) return decodeURIComponent(last) + fallbackExt
    return u.host.replace(/^www\./, '') + fallbackExt
  } catch {
    return 'download' + fallbackExt
  }
}

/** 人类可读字节：14.2 MB / 680 MB / 2.1 MB / 320 KB。演示够用，不追求 IEC 精确。 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`
}
