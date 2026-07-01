import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Baseline, Highlighter, Eraser, Info, Trash2 } from 'lucide-react'
import type { Doc } from '../types'
import './BasicEditor.css'

// 打开「不符合 Schema」的野生 HTML 时的基础编辑视图。见 docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md。
// 立场：文件在沙箱 iframe 里全保真渲染（<style> 隔离、<script> 不执行）；编辑器 chrome（格式条 / 焦点框 /
// 删除按钮）一律走**宿主浮层**、绝不注进 iframe DOM（不污染文件字节）。三个能力：
//   A 富就地文字编辑（B/I/U/S + 文字色/高亮/清除）  B 删整块  C 空间切块（方向键按渲染几何找最近的块）
// 编辑/删除 keyed 到节点身份；导航用 getBoundingClientRect 的渲染矩形做 nearestInDirection，都不依赖 DOM 顺序。

interface Rect { top: number; left: number; width: number; height: number }
type Bubble = { top: number; left: number }

const TOOLS = [
  { cmd: 'bold', icon: Bold, label: '加粗' },
  { cmd: 'italic', icon: Italic, label: '斜体' },
  { cmd: 'underline', icon: Underline, label: '下划线' },
  { cmd: 'strikeThrough', icon: Strikethrough, label: '删除线' },
  { sep: true as const },
  { cmd: 'foreColor', val: '#e8654f', icon: Baseline, label: '文字色' },
  { cmd: 'hiliteColor', val: '#fff3a0', icon: Highlighter, label: '高亮' },
  { cmd: 'removeFormat', icon: Eraser, label: '清除格式' },
]

// 收集「可导航 / 可删除的块」：媒体 / 表格 / 列表整块，加上不在这些容器里的「有直接文字」的元素；
// 跳过表格 / 列表内部（它们作为一个块）和文字块的行内子（如 <h1> 里的 <span>）。
function collectBlocks(body: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = []
  const skip = new Set<Element>()
  body.querySelectorAll('img,hr,iframe,table,ul,ol,svg').forEach((el) => {
    blocks.push(el as HTMLElement)
    el.querySelectorAll('*').forEach((d) => skip.add(d))
  })
  const hasDirectText = (el: Element) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length)
  body.querySelectorAll('*').forEach((el) => {
    if (skip.has(el)) return
    if (el.closest('table,ul,ol,svg')) return
    if (['SCRIPT', 'STYLE', 'BR', 'HEAD'].includes(el.tagName)) return
    if (!hasDirectText(el)) return
    // 跳过「有直接文字的父」的行内子（例：<h1>让灵感<span>流动</span>起来</h1> 里的 span）
    if (el.parentElement && hasDirectText(el.parentElement) && !skip.has(el.parentElement)) return
    blocks.push(el as HTMLElement)
  })
  return blocks
}

type Dir = 'up' | 'down' | 'left' | 'right'
function nearestInDir(cur: HTMLElement, dir: Dir, all: HTMLElement[]): HTMLElement | null {
  const cr = cur.getBoundingClientRect()
  const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2
  let best: HTMLElement | null = null, bestScore = Infinity
  for (const el of all) {
    if (el === cur) continue
    const r = el.getBoundingClientRect()
    if (!r.width && !r.height) continue
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const dx = x - cx, dy = y - cy
    let inDir: boolean, primary: number, cross: number
    if (dir === 'down') { inDir = dy > 6; primary = dy; cross = Math.abs(dx) }
    else if (dir === 'up') { inDir = dy < -6; primary = -dy; cross = Math.abs(dx) }
    else if (dir === 'right') { inDir = dx > 6; primary = dx; cross = Math.abs(dy) }
    else { inDir = dx < -6; primary = -dx; cross = Math.abs(dy) }
    if (!inDir) continue
    const score = primary + cross * 2
    if (score < bestScore) { bestScore = score; best = el }
  }
  return best
}

export default function BasicEditor({ doc }: { doc: Doc }) {
  const html = doc.rawHtml ?? ''
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [focus, setFocus] = useState<Rect | null>(null)

  // 可变状态放 ref，避免高频 re-render
  const blocksRef = useRef<HTMLElement[]>([])
  const focusElRef = useRef<HTMLElement | null>(null)
  const modeRef = useRef<'text' | 'block'>('text')

  useEffect(() => {
    const f = frameRef.current
    const host = hostRef.current
    if (!f || !host) return

    const docOf = () => f.contentDocument
    const bodyOf = () => f.contentDocument?.body

    // 把 iframe 内元素的矩形换算成宿主浮层坐标（.nce 是定位上下文）
    const toHost = (el: HTMLElement): Rect => {
      const fr = f.getBoundingClientRect()
      const hr = host.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { top: fr.top - hr.top + r.top, left: fr.left - hr.left + r.left, width: r.width, height: r.height }
    }

    const clearFocus = () => { focusElRef.current = null; setFocus(null) }
    const paintFocus = () => { const el = focusElRef.current; setFocus(el ? toHost(el) : null) }
    const setFocusEl = (el: HTMLElement | null) => {
      focusElRef.current = el
      if (el) { el.scrollIntoView({ block: 'nearest' }); paintFocus() } else setFocus(null)
    }

    const refreshBubble = () => {
      const d = docOf(); const sel = d?.getSelection()
      if (modeRef.current !== 'text' || !sel || sel.isCollapsed || sel.rangeCount === 0) { setBubble(null); return }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (!r || (r.width === 0 && r.height === 0)) { setBubble(null); return }
      const fr = f.getBoundingClientRect(); const hr = host.getBoundingClientRect()
      setBubble({ top: Math.max(6, fr.top - hr.top + r.top - 44), left: fr.left - hr.left + r.left + r.width / 2 })
    }

    // 进入「文字模式」：body 可编辑；进入「块模式」：body 不可编辑，方向键切块
    const toText = () => { const b = bodyOf(); if (b) b.contentEditable = 'true'; modeRef.current = 'text'; clearFocus() }
    const toBlock = (from?: HTMLElement | null) => {
      const b = bodyOf(); if (!b) return
      setBubble(null); b.contentEditable = 'false'; modeRef.current = 'block'
      const blocks = blocksRef.current
      const start = from || blocks[0] || null
      setFocusEl(start)
    }
    const caretTo = (el: HTMLElement) => {
      const d = docOf(); if (!d) return
      const b = bodyOf(); if (b) b.contentEditable = 'true'
      modeRef.current = 'text'; clearFocus()
      const range = d.createRange(); range.selectNodeContents(el); range.collapse(true)
      const sel = d.getSelection(); sel?.removeAllRanges(); sel?.addRange(range)
      ;(el as HTMLElement).focus?.()
    }
    const delFocus = () => {
      const el = focusElRef.current; if (!el) return
      const next = nearestInDir(el, 'down', blocksRef.current) || nearestInDir(el, 'up', blocksRef.current)
      el.remove()
      blocksRef.current = collectBlocks(bodyOf()!)
      setFocusEl(next && blocksRef.current.includes(next) ? next : blocksRef.current[0] || null)
    }

    const onMouseDown = () => {
      // 块模式下点一下 → 回文字模式，让这次点击自然落光标
      if (modeRef.current === 'block') { const b = bodyOf(); if (b) b.contentEditable = 'true'; modeRef.current = 'text'; clearFocus() }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); const d = docOf(); const anchor = d?.getSelection()?.anchorNode as Node | null; const blk = anchor && (anchor.nodeType === 3 ? anchor.parentElement : (anchor as HTMLElement))?.closest?.('*'); const near = blocksRef.current.find((x) => blk && x.contains(blk)) || null; toBlock(near); return }
      if (modeRef.current !== 'block') return
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      if (map[e.key]) { e.preventDefault(); const el = focusElRef.current; if (!el) { setFocusEl(blocksRef.current[0] || null); return } const n = nearestInDir(el, map[e.key], blocksRef.current); if (n) setFocusEl(n) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delFocus() }
      else if (e.key === 'Enter') { e.preventDefault(); const el = focusElRef.current; if (el) caretTo(el) }
    }

    const wire = () => {
      const d = docOf(); if (!d || !d.body) return
      d.body.contentEditable = 'true'; d.body.style.outline = 'none'; d.body.style.cursor = 'text'
      modeRef.current = 'text'
      blocksRef.current = collectBlocks(d.body)
      d.addEventListener('selectionchange', refreshBubble)
      d.addEventListener('mouseup', refreshBubble)
      d.addEventListener('keyup', refreshBubble)
      d.addEventListener('mousedown', onMouseDown, true)
      d.addEventListener('keydown', onKeyDown, true)
      d.addEventListener('scroll', () => { refreshBubble(); paintFocus() }, true)
    }

    f.addEventListener('load', wire)
    if (f.contentDocument?.readyState === 'complete') wire()

    // 宿主侧暴露给按钮用
    ;(host as unknown as { _nce?: unknown })._nce = { toText, delFocus }

    return () => {
      const d = docOf()
      d?.removeEventListener('selectionchange', refreshBubble)
      d?.removeEventListener('mouseup', refreshBubble)
      d?.removeEventListener('keyup', refreshBubble)
      f.removeEventListener('load', wire)
    }
  }, [html])

  const exec = (cmd: string, val?: string) => {
    const d = frameRef.current?.contentDocument
    if (!d) return
    try { d.execCommand('styleWithCSS', false, 'true') } catch { /* noop */ }
    try { d.execCommand(cmd, false, val) } catch { /* execCommand 已废弃但浏览器仍支持 */ }
  }
  const deleteFocused = () => (hostRef.current as unknown as { _nce?: { delFocus: () => void } })?._nce?.delFocus?.()

  return (
    <div className="nce" ref={hostRef}>
      <div className="nce-notice">
        <Info size={15} />
        <span>
          这个文件不符合 Wordspace Schema，<strong>仅支持基础编辑</strong>：改文字（粗/斜/下/删 + 文字色/高亮/清除）、按方向键在块间移动、删整块。结构化编辑（斜杠菜单、AI 排版）对它停用。
        </span>
      </div>

      <div className="nce-stage">
        <iframe ref={frameRef} className="nce-frame" title={doc.title} sandbox="allow-same-origin" srcDoc={html} />
      </div>

      {/* 焦点框 + 删除按钮（宿主浮层，不进 iframe） */}
      {focus && (
        <div className="nce-focus" style={{ top: focus.top, left: focus.left, width: focus.width, height: focus.height }}>
          <button className="nce-focus-del" title="删除此块 (Delete)" onMouseDown={(e) => e.preventDefault()} onClick={deleteFocused}>
            <Trash2 size={13} /> 删除此块
          </button>
        </div>
      )}

      {/* 富文字浮动格式条 */}
      {bubble && (
        <div className="ws-fmtbar nce-bubble" style={{ top: bubble.top, left: bubble.left }} onMouseDown={(e) => e.preventDefault()} role="toolbar">
          {TOOLS.map((t, i) =>
            'sep' in t ? (
              <span key={i} className="nce-bubble-sep" />
            ) : (
              <button key={i} className="ws-fmtbar-btn" title={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(t.cmd!, t.val)}>
                <t.icon size={15} />
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
