import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import './DocFind.css'

// 文档内查找（Cmd+F）。调研裁决：Cmd+F 是所有软件的铁律=在当前文档里找字，
// 文件筛选让位到 Cmd+Shift+F。匹配高亮走 CSS Custom Highlight API——只画高亮、
// 不改 DOM、不动文档模型（纯视觉覆盖，撤销/存盘都不受影响），比往 contenteditable
// 里塞 <mark> 干净得多。current 匹配另用一层高亮 + 滚动到视野。

const HL = 'ws-find-hit'
const HL_CUR = 'ws-find-cur'
type HLApi = { set: (k: string, h: unknown) => void; delete: (k: string) => void }
const highlights = (): HLApi | null =>
  typeof CSS !== 'undefined' && 'highlights' in CSS ? ((CSS as unknown as { highlights: HLApi }).highlights) : null

// 在容器里按（大小写不敏感）子串收集所有匹配的 Range。逐个文本节点扫，跳过查找栏自身。
function collectMatches(container: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase()
  if (!q) return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement
      if (!p || p.closest('.ws-docfind')) return NodeFilter.FILTER_REJECT
      return n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue ?? '').toLowerCase()
    let from = 0
    for (;;) {
      const i = text.indexOf(q, from)
      if (i < 0) break
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + q.length)
      ranges.push(r)
      from = i + q.length
    }
  }
  return ranges
}

export default function DocFind({ container, onClose }: { container: HTMLElement | null; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [cur, setCur] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开即聚焦输入框（并选中已有词，方便连续搜）
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const matches = useMemo(() => (container ? collectMatches(container, query) : []), [container, query])
  const count = matches.length
  const active = count ? ((cur % count) + count) % count : 0

  // 查询变了 → 回到第一个匹配
  useEffect(() => setCur(0), [query])

  // 应用高亮（所有匹配一层，current 一层）。useLayoutEffect：布局前就位，避免闪。
  useLayoutEffect(() => {
    const api = highlights()
    if (!api) return
    const Ctor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    if (!Ctor) return
    if (!count) {
      api.delete(HL)
      api.delete(HL_CUR)
      return
    }
    api.set(HL, new Ctor(...matches))
    api.set(HL_CUR, new Ctor(matches[active]))
    // 滚动当前匹配进视野
    const el = matches[active].startContainer.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return () => {
      api.delete(HL)
      api.delete(HL_CUR)
    }
  }, [matches, active, count])

  // 关闭时清高亮
  useEffect(() => {
    return () => {
      const api = highlights()
      api?.delete(HL)
      api?.delete(HL_CUR)
    }
  }, [])

  const go = (dir: 1 | -1) => count && setCur((c) => c + dir)

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return // 中文/日文组字中按 Enter = 确认候选词，别当「跳下一个匹配」（同 Canvas 守法）
      e.preventDefault()
      go(e.shiftKey ? -1 : 1)
    }
  }

  return (
    <div className="ws-docfind" role="search" onKeyDown={onKey}>
      <input
        ref={inputRef}
        className="ws-docfind-input"
        placeholder="在文档中查找"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        aria-label="在文档中查找"
      />
      <span className="ws-docfind-count" aria-live="polite">
        {query ? (count ? `${active + 1} / ${count}` : '无结果') : ''}
      </span>
      <div className="ws-docfind-nav">
        <button className="ws-docfind-btn" title="上一个 (Shift+Enter)" onClick={() => go(-1)} disabled={!count} aria-label="上一个匹配">
          <ChevronUp size={15} />
        </button>
        <button className="ws-docfind-btn" title="下一个 (Enter)" onClick={() => go(1)} disabled={!count} aria-label="下一个匹配">
          <ChevronDown size={15} />
        </button>
      </div>
      <button className="ws-docfind-btn ws-docfind-close" title="关闭 (Esc)" onClick={onClose} aria-label="关闭查找">
        <X size={15} />
      </button>
    </div>
  )
}
