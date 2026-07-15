import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Eraser, Info, Trash2 } from 'lucide-react'
import type { Doc } from '../types'
import { DocHeader } from './Canvas'
import { useAppearance } from '../appearance'
// 配方镜像（正本 = 真 app src/lib/doc-dark-recipe.js,U6 直接搬那份）。
import { recipeCss, isAlreadyDark } from '../docDark'
import './BasicEditor.css'

// 深色下给 iframe 文档注/摘反色滤镜。滤镜挂 html(documentElement),媒体反反色,已暗文档跳过。
// 防重注:按 id 判存在。ui-demo 无 CSP,用 <style>(与 revealAll 同法);真 app 有 CSP 走 adoptedStyleSheets。
const DOC_DARK_ID = 'ws-doc-dark'
function syncDocDark(d: Document, dark: boolean): void {
  const existing = d.getElementById(DOC_DARK_ID)
  if (!dark) { existing?.remove(); return }
  const win = d.defaultView
  const htmlBg = win ? win.getComputedStyle(d.documentElement).backgroundColor : ''
  const bodyBg = win && d.body ? win.getComputedStyle(d.body).backgroundColor : ''
  if (isAlreadyDark([htmlBg, bodyBg])) { existing?.remove(); return }
  if (existing) return
  const st = d.createElement('style'); st.id = DOC_DARK_ID
  st.textContent = recipeCss('html')
  d.head?.appendChild(st)
}

// 打开「不符合 Schema」的野生 HTML 时的基础编辑视图。见 docs/brainstorms/2026-07-01-nonconform-html-editing-requirements.md。
// 文件在沙箱 iframe 里全保真渲染（<style> 隔离、<script> 不执行）；编辑器 chrome（格式条 / 焦点框）
// 一律走**宿主浮层**、绝不注进 iframe DOM。三个能力：A 富就地文字（B/I/U/S + 文字色/高亮/清除）· B 删整块
// （Esc 选块后 Delete；悬停虚线框+🗑 已撤，Wendi 2026-07-14，见 docs/features/basic-edit.md）
// · C 空间切块（Esc 后方向键按渲染几何找最近的块）。
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
  // C 方案：编辑态（默认）= 不跑 JS + 展开全部（reveal-all）；预览态 = 跑文档 JS 看交互原貌、只读。
  const [view, setView] = useState<'edit' | 'preview'>('edit')

  const blocksRef = useRef<HTMLElement[]>([])
  const focusElRef = useRef<HTMLElement | null>(null)
  const modeRef = useRef<'text' | 'block'>('text')
  const effective = useAppearance((s) => s.effective)
  const effectiveRef = useRef(effective)
  effectiveRef.current = effective

  // 主题实时切换:不重挂 iframe,只对当前 live 文档注/摘滤镜。
  useEffect(() => {
    const f = frameRef.current
    if (!f) return
    const dark = effective === 'dark'
    if (view === 'preview') {
      f.style.filter = dark ? 'invert(1) hue-rotate(180deg)' : ''
      return
    }
    f.style.filter = ''
    const d = f.contentDocument
    if (d && d.body) syncDocDark(d, dark)
  }, [effective, view])

  useEffect(() => {
    const f = frameRef.current
    const host = hostRef.current
    if (!f || !host) return

    // 预览态：iframe 用 allow-scripts（跑文档 JS、隔离，跨源无法注 constructable sheet），
    // 只读，编辑 chrome 全不挂；深色反色由上面的实时 effect 对 iframe 元素整体施 filter。
    if (view === 'preview') { setBubble(null); setMenu(null); setFocus(null); return }

    const docOf = () => f.contentDocument
    const bodyOf = () => f.contentDocument?.body

    // 展开全部：不跑 JS，所以用 CSS + 类把被隐藏（[hidden] / display:none / visibility:hidden）的内容
    // 强制显示出来，让 JS 藏起来的 tab 面板、折叠内容都可见可编辑。编辑器托管的 style 带 data-ws-schema-css。
    const revealAll = (d: Document) => {
      const st = d.createElement('style'); st.setAttribute('data-ws-schema-css', 'reveal')
      // reveal-all + 让窄内容在画布里居中（body 有 max-width 时居中；满宽 body 不受影响）
      st.textContent = '[hidden],.ws-nce-reveal{display:revert !important;visibility:visible !important;opacity:1 !important;height:auto !important;max-height:none !important;} body{margin-left:auto !important;margin-right:auto !important;}'
      d.head?.appendChild(st)
      const win = d.defaultView; if (!win) return
      const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'TEMPLATE', 'BR', 'NOSCRIPT', 'BASE'])
      d.body?.querySelectorAll('*').forEach((el) => {
        if (SKIP.has(el.tagName)) return
        const cs = win.getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden') el.classList.add('ws-nce-reveal')
      })
    }

    const toHost = (el: HTMLElement): Rect => {
      const fr = f.getBoundingClientRect(); const hr = host.getBoundingClientRect(); const r = el.getBoundingClientRect()
      return { top: fr.top - hr.top + r.top, left: fr.left - hr.left + r.left, width: r.width, height: r.height }
    }

    const clearFocus = () => { focusElRef.current = null; setFocus(null) }
    const setFocusEl = (el: HTMLElement | null) => {
      focusElRef.current = el
      if (el) { el.scrollIntoView({ block: 'nearest' }); setFocus(toHost(el)) } else setFocus(null)
    }
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
      setBubble(null); setMenu(null); b.contentEditable = 'false'; modeRef.current = 'block'
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
      if (keepFocusNext) setFocusEl(next && blocksRef.current.includes(next) ? next : blocksRef.current[0] || null)
      else if (focusElRef.current === el) clearFocus()
    }

    const onMouseDown = () => {
      if (modeRef.current === 'block') { const b = bodyOf(); if (b) b.contentEditable = 'true'; modeRef.current = 'text'; clearFocus() }
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
      revealAll(d) // 先展开全部被 JS 藏起来的内容，再收集块
      syncDocDark(d, effectiveRef.current === 'dark') // 深色下注反色滤镜(样式生效后采样,已暗跳过)
      d.body.contentEditable = 'true'; d.body.style.outline = 'none'; d.body.style.cursor = 'text'
      modeRef.current = 'text'; blocksRef.current = collectBlocks(d.body)
      d.addEventListener('selectionchange', refreshBubble)
      d.addEventListener('mouseup', refreshBubble)
      d.addEventListener('keyup', refreshBubble)
      d.addEventListener('mousedown', onMouseDown, true)
      d.addEventListener('keydown', onKeyDown, true)
      d.addEventListener('scroll', () => { refreshBubble(); if (focusElRef.current) setFocus(toHost(focusElRef.current)) }, true)
    }

    f.addEventListener('load', wire)
    if (f.contentDocument?.readyState === 'complete') wire()
    ;(host as unknown as { _nce?: unknown })._nce = {
      deleteFocused: () => { if (focusElRef.current) removeBlock(focusElRef.current, true) },
    }

    return () => {
      const d = docOf()
      d?.removeEventListener('selectionchange', refreshBubble)
      d?.removeEventListener('mouseup', refreshBubble)
      d?.removeEventListener('keyup', refreshBubble)
      f.removeEventListener('load', wire)
    }
  }, [html, view])

  const api = () => (hostRef.current as unknown as { _nce?: { deleteFocused(): void } })?._nce
  const exec = (cmd: string, val?: string) => {
    const d = frameRef.current?.contentDocument; if (!d) return
    try { d.execCommand('styleWithCSS', false, 'true') } catch { /* noop */ }
    try { d.execCommand(cmd, false, val) } catch { /* execCommand 已废弃但浏览器仍支持 */ }
    setMenu(null)
  }
  const guard = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="nce" ref={hostRef}>
      {/* 顶边栏：始终保留（跟合规文档一致的面包屑 + … 菜单 + 编辑于），右侧放 编辑/预览 切换 */}
      <div className="nce-head">
        <div className="nce-head-doc"><DocHeader doc={doc} /></div>
        <div className="nce-modes" onMouseDown={guard}>
          <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}>编辑</button>
          <button className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>预览</button>
        </div>
      </div>

      <div className="nce-stage">
        <iframe
          key={view}
          ref={frameRef}
          className="nce-frame"
          title={doc.title}
          sandbox={view === 'preview' ? 'allow-scripts' : 'allow-same-origin'}
          srcDoc={html}
        />
      </div>

      {/* 中立、精简的提示，放文档下方 */}
      <div className="nce-notice">
        <Info size={15} />
        <span>该文件不符合 Wordspace Schema，仅支持基础编辑。</span>
      </div>

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
