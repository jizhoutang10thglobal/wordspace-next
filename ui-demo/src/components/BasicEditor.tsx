import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Eraser, Info, Trash2 } from 'lucide-react'
import type { Doc } from '../types'
import './BasicEditor.css'

// 打开「不符合 Schema」的野生 HTML 时的基础编辑视图。见 docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md。
// 文件在沙箱 iframe 里全保真渲染（<style> 隔离、<script> 不执行）；编辑器 chrome（格式条 / 焦点框 / 悬停删除）
// 一律走**宿主浮层**、绝不注进 iframe DOM。三个能力：A 富就地文字（B/I/U/S + 文字色/高亮/清除）· B 删整块
// （悬停右上角 🗑，或 Esc 选块后 Delete）· C 空间切块（Esc 后方向键按渲染几何找最近的块）。
// 编辑/删除 keyed 到节点身份；导航用 getBoundingClientRect 的渲染矩形做 nearestInDirection，不依赖 DOM 顺序。

// 跟正规编辑器（components/canvas/FormatToolbar.tsx）同一套调色板。
const TEXT_COLORS = ['#1a1a1a', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2']
const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff']

interface Rect { top: number; left: number; width: number; height: number }
type Bubble = { top: number; left: number }

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
  const [menu, setMenu] = useState<'color' | 'hilite' | null>(null)
  const [focus, setFocus] = useState<Rect | null>(null)
  const [hover, setHover] = useState<Rect | null>(null)

  const blocksRef = useRef<HTMLElement[]>([])
  const focusElRef = useRef<HTMLElement | null>(null)
  const hoverElRef = useRef<HTMLElement | null>(null)
  const modeRef = useRef<'text' | 'block'>('text')
  const hoverTimer = useRef<number>(0)

  useEffect(() => {
    const f = frameRef.current
    const host = hostRef.current
    if (!f || !host) return

    const docOf = () => f.contentDocument
    const bodyOf = () => f.contentDocument?.body

    const toHost = (el: HTMLElement): Rect => {
      const fr = f.getBoundingClientRect(); const hr = host.getBoundingClientRect(); const r = el.getBoundingClientRect()
      return { top: fr.top - hr.top + r.top, left: fr.left - hr.left + r.left, width: r.width, height: r.height }
    }

    const clearFocus = () => { focusElRef.current = null; setFocus(null) }
    const setFocusEl = (el: HTMLElement | null) => {
      focusElRef.current = el
      if (el) { el.scrollIntoView({ block: 'nearest' }); setFocus(toHost(el)) } else setFocus(null)
    }
    const clearHover = () => { hoverElRef.current = null; setHover(null) }

    const refreshBubble = () => {
      const d = docOf(); const sel = d?.getSelection()
      if (modeRef.current !== 'text' || !sel || sel.isCollapsed || sel.rangeCount === 0) { setBubble(null); setMenu(null); return }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (!r || (r.width === 0 && r.height === 0)) { setBubble(null); setMenu(null); return }
      const fr = f.getBoundingClientRect(); const hr = host.getBoundingClientRect()
      setBubble({ top: Math.max(6, fr.top - hr.top + r.top - 46), left: fr.left - hr.left + r.left + r.width / 2 })
    }

    const toBlock = (from?: HTMLElement | null) => {
      const b = bodyOf(); if (!b) return
      setBubble(null); setMenu(null); clearHover(); b.contentEditable = 'false'; modeRef.current = 'block'
      setFocusEl(from || blocksRef.current[0] || null)
    }
    const caretTo = (el: HTMLElement) => {
      const d = docOf(); if (!d) return
      const b = bodyOf(); if (b) b.contentEditable = 'true'
      modeRef.current = 'text'; clearFocus()
      const range = d.createRange(); range.selectNodeContents(el); range.collapse(true)
      const sel = d.getSelection(); sel?.removeAllRanges(); sel?.addRange(range)
    }
    const removeBlock = (el: HTMLElement, keepFocusNext: boolean) => {
      const next = keepFocusNext
        ? nearestInDir(el, 'down', blocksRef.current) || nearestInDir(el, 'up', blocksRef.current)
        : null
      el.remove()
      const body = bodyOf(); blocksRef.current = body ? collectBlocks(body) : []
      clearHover()
      if (keepFocusNext) setFocusEl(next && blocksRef.current.includes(next) ? next : blocksRef.current[0] || null)
      else if (focusElRef.current === el) clearFocus()
    }

    const blockAt = (target: EventTarget | null): HTMLElement | null => {
      const t = target as Element | null; if (!t) return null
      const hits = blocksRef.current.filter((b) => b === t || b.contains(t))
      if (!hits.length) return null
      return hits.reduce((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height <=
        b.getBoundingClientRect().width * b.getBoundingClientRect().height ? a : b))
    }

    const onMouseDown = () => {
      if (modeRef.current === 'block') { const b = bodyOf(); if (b) b.contentEditable = 'true'; modeRef.current = 'text'; clearFocus() }
    }
    const onMouseMove = (e: MouseEvent) => {
      if (modeRef.current !== 'text') return
      const blk = blockAt(e.target)
      if (!blk) { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(clearHover, 160); return }
      window.clearTimeout(hoverTimer.current)
      if (blk !== hoverElRef.current) { hoverElRef.current = blk; setHover(toHost(blk)) }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        const d = docOf(); const a = d?.getSelection()?.anchorNode as Node | null
        const start = a ? (a.nodeType === 3 ? a.parentElement : (a as HTMLElement)) : null
        toBlock(blocksRef.current.find((x) => start && x.contains(start)) || null)
        return
      }
      if (modeRef.current !== 'block') return
      const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      if (map[e.key]) { e.preventDefault(); const el = focusElRef.current; const n = el ? nearestInDir(el, map[e.key], blocksRef.current) : blocksRef.current[0]; if (n) setFocusEl(n) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (focusElRef.current) removeBlock(focusElRef.current, true) }
      else if (e.key === 'Enter') { e.preventDefault(); if (focusElRef.current) caretTo(focusElRef.current) }
    }

    const wire = () => {
      const d = docOf(); if (!d || !d.body) return
      d.body.contentEditable = 'true'; d.body.style.outline = 'none'; d.body.style.cursor = 'text'
      modeRef.current = 'text'; blocksRef.current = collectBlocks(d.body)
      d.addEventListener('selectionchange', refreshBubble)
      d.addEventListener('mouseup', refreshBubble)
      d.addEventListener('keyup', refreshBubble)
      d.addEventListener('mousedown', onMouseDown, true)
      d.addEventListener('mousemove', onMouseMove, true)
      d.addEventListener('keydown', onKeyDown, true)
      d.addEventListener('scroll', () => { refreshBubble(); if (focusElRef.current) setFocus(toHost(focusElRef.current)); clearHover() }, true)
      d.body.addEventListener('mouseleave', () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(clearHover, 160) })
    }

    f.addEventListener('load', wire)
    if (f.contentDocument?.readyState === 'complete') wire()
    ;(host as unknown as { _nce?: unknown })._nce = {
      deleteHovered: () => { if (hoverElRef.current) removeBlock(hoverElRef.current, false) },
      deleteFocused: () => { if (focusElRef.current) removeBlock(focusElRef.current, true) },
      cancelHoverClear: () => window.clearTimeout(hoverTimer.current),
    }

    return () => {
      const d = docOf()
      d?.removeEventListener('selectionchange', refreshBubble)
      d?.removeEventListener('mouseup', refreshBubble)
      d?.removeEventListener('keyup', refreshBubble)
      f.removeEventListener('load', wire)
    }
  }, [html])

  const api = () => (hostRef.current as unknown as { _nce?: { deleteHovered(): void; deleteFocused(): void; cancelHoverClear(): void } })?._nce
  const exec = (cmd: string, val?: string) => {
    const d = frameRef.current?.contentDocument; if (!d) return
    try { d.execCommand('styleWithCSS', false, 'true') } catch { /* noop */ }
    try { d.execCommand(cmd, false, val) } catch { /* execCommand 已废弃但浏览器仍支持 */ }
    setMenu(null)
  }
  const guard = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="nce" ref={hostRef}>
      <div className="nce-notice">
        <Info size={15} />
        <span>
          这个文件不符合 Wordspace Schema，<strong>仅支持基础编辑</strong>：点文字改字（选中出格式条：粗/斜/下/删 + 文字色/高亮/清除）· 悬停任意块右上角 <strong>🗑 删除</strong> · 按 <strong>Esc</strong> 后用方向键在块间移动、Delete 删除。
        </span>
      </div>

      <div className="nce-stage">
        <iframe ref={frameRef} className="nce-frame" title={doc.title} sandbox="allow-same-origin" srcDoc={html} />
      </div>

      {/* 悬停某块 → 右上角删除（鼠标路径，不用记 Esc） */}
      {hover && (
        <div className="nce-hover" style={{ top: hover.top, left: hover.left, width: hover.width, height: hover.height }}>
          <button
            className="nce-hover-del"
            title="删除这一块"
            onMouseEnter={() => api()?.cancelHoverClear()}
            onMouseDown={guard}
            onClick={() => api()?.deleteHovered()}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {/* 焦点框 + 删除（Esc 块模式 / 键盘） */}
      {focus && (
        <div className="nce-focus" style={{ top: focus.top, left: focus.left, width: focus.width, height: focus.height }}>
          <button className="nce-focus-del" title="删除此块 (Delete)" onMouseDown={guard} onClick={() => api()?.deleteFocused()}>
            <Trash2 size={13} /> 删除此块
          </button>
        </div>
      )}

      {/* 富文字浮动格式条 */}
      {bubble && (
        <div className="ws-fmtbar nce-bubble" style={{ top: bubble.top, left: bubble.left }} onMouseDown={guard} role="toolbar">
          <button className="ws-fmtbar-btn" title="加粗" onMouseDown={guard} onClick={() => exec('bold')}><Bold size={15} /></button>
          <button className="ws-fmtbar-btn" title="斜体" onMouseDown={guard} onClick={() => exec('italic')}><Italic size={15} /></button>
          <button className="ws-fmtbar-btn" title="下划线" onMouseDown={guard} onClick={() => exec('underline')}><Underline size={15} /></button>
          <button className="ws-fmtbar-btn" title="删除线" onMouseDown={guard} onClick={() => exec('strikeThrough')}><Strikethrough size={15} /></button>
          <span className="ws-fmtbar-sep" />

          <div className="ws-fmtbar-holder">
            <button className="ws-fmtbar-btn ws-fmtbar-aglyph" title="文字颜色" onMouseDown={guard} onClick={() => setMenu(menu === 'color' ? null : 'color')}>A</button>
            {menu === 'color' && (
              <div className="ws-fmtbar-swatches" onMouseDown={guard}>
                {TEXT_COLORS.map((c) => (
                  <button key={c} className="ws-fmtbar-swatch" style={{ background: c }} title={c} onMouseDown={guard} onClick={() => exec('foreColor', c)} />
                ))}
              </div>
            )}
          </div>

          <div className="ws-fmtbar-holder">
            <button className="ws-fmtbar-btn" title="背景高亮" onMouseDown={guard} onClick={() => setMenu(menu === 'hilite' ? null : 'hilite')}>🖍</button>
            {menu === 'hilite' && (
              <div className="ws-fmtbar-swatches" onMouseDown={guard}>
                {HILITE_COLORS.map((c) => (
                  <button key={c} className="ws-fmtbar-swatch" style={{ background: c }} title={c} onMouseDown={guard} onClick={() => exec('hiliteColor', c)} />
                ))}
              </div>
            )}
          </div>

          <span className="ws-fmtbar-sep" />
          <button className="ws-fmtbar-btn" title="清除格式" onMouseDown={guard} onClick={() => exec('removeFormat')}><Eraser size={15} /></button>
        </div>
      )}
    </div>
  )
}
