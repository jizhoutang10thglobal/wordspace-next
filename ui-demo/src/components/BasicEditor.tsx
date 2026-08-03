import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Eraser, Info } from 'lucide-react'
import { useT } from '../i18n'
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
// 文件在沙箱 iframe 里全保真渲染（<style> 隔离、<script> 不执行）；编辑器 chrome（格式条）走**宿主浮层**、
// 绝不注进 iframe DOM。能力：A 富就地文字（B/I/U/S + 文字色/高亮/清除）· 删除全走 contenteditable 原生
// 「选中 + Delete」。曾有 Esc 块模式 + 右上「删除此块」chip，因按钮不可靠/不可发现整体撤除（Colin 2026-07-21，
// 见 docs/features/basic-edit.md）。

// 跟正规编辑器（components/canvas/FormatToolbar.tsx）同一套调色板。
const TEXT_COLORS = ['#1a1a1a', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2']
const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff']

type Bubble = { top: number; left: number }

export default function BasicEditor({ doc }: { doc: Doc }) {
  const t = useT()
  const html = doc.rawHtml ?? ''
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [menu, setMenu] = useState<'color' | 'hilite' | null>(null)
  // C 方案：编辑态（默认）= 不跑 JS + 展开全部（reveal-all）；预览态 = 跑文档 JS 看交互原貌、只读。
  const [view, setView] = useState<'edit' | 'preview'>('edit')
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
    if (view === 'preview') { setBubble(null); setMenu(null); return }

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

    const refreshBubble = () => {
      const d = docOf(); const sel = d?.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setBubble(null); setMenu(null); return }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (!r || (r.width === 0 && r.height === 0)) { setBubble(null); setMenu(null); return }
      const fr = f.getBoundingClientRect(); const hr = host.getBoundingClientRect()
      setBubble({ top: Math.max(6, fr.top - hr.top + r.top - 46), left: fr.left - hr.left + r.left + r.width / 2 })
    }

    const onSel = () => refreshBubble()
    const onScrollDoc = () => refreshBubble()
    const wire = () => {
      const d = docOf(); if (!d || !d.body) return
      revealAll(d) // 先展开全部被 JS 藏起来的内容，再收集块
      syncDocDark(d, effectiveRef.current === 'dark') // 深色下注反色滤镜(样式生效后采样,已暗跳过)
      d.body.contentEditable = 'true'; d.body.style.outline = 'none'; d.body.style.cursor = 'text'
      d.addEventListener('selectionchange', onSel)
      d.addEventListener('mouseup', onSel)
      d.addEventListener('keyup', onSel)
      d.addEventListener('scroll', onScrollDoc, true)
    }

    f.addEventListener('load', wire)
    if (f.contentDocument?.readyState === 'complete') wire()

    return () => {
      const d = docOf()
      d?.removeEventListener('selectionchange', onSel)
      d?.removeEventListener('mouseup', onSel)
      d?.removeEventListener('keyup', onSel)
      f.removeEventListener('load', wire)
    }
  }, [html, view])

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
          <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}>{t('common.edit')}</button>
          <button className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>{t('editor.preview')}</button>
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
        <span>{t('editor.nonconformNotice')}</span>
      </div>

      {/* 富文字浮动格式条 */}
      {bubble && (
        <div className="ws-fmtbar nce-bubble" style={{ top: bubble.top, left: bubble.left }} onMouseDown={guard} role="toolbar">
          <button className="ws-fmtbar-btn" title={t('editor.bold')} onMouseDown={guard} onClick={() => exec('bold')}><Bold size={15} /></button>
          <button className="ws-fmtbar-btn" title={t('editor.italic')} onMouseDown={guard} onClick={() => exec('italic')}><Italic size={15} /></button>
          <button className="ws-fmtbar-btn" title={t('editor.underline')} onMouseDown={guard} onClick={() => exec('underline')}><Underline size={15} /></button>
          <button className="ws-fmtbar-btn" title={t('editor.strikethrough')} onMouseDown={guard} onClick={() => exec('strikeThrough')}><Strikethrough size={15} /></button>
          <span className="ws-fmtbar-sep" />

          <div className="ws-fmtbar-holder">
            <button className="ws-fmtbar-btn ws-fmtbar-aglyph" title={t('editor.textColor')} onMouseDown={guard} onClick={() => setMenu(menu === 'color' ? null : 'color')}>A</button>
            {menu === 'color' && (
              <div className="ws-fmtbar-swatches" onMouseDown={guard}>
                {TEXT_COLORS.map((c) => (
                  <button key={c} className="ws-fmtbar-swatch" style={{ background: c }} title={c} onMouseDown={guard} onClick={() => exec('foreColor', c)} />
                ))}
              </div>
            )}
          </div>

          <div className="ws-fmtbar-holder">
            <button className="ws-fmtbar-btn" title={t('editor.highlight')} onMouseDown={guard} onClick={() => setMenu(menu === 'hilite' ? null : 'hilite')}>🖍</button>
            {menu === 'hilite' && (
              <div className="ws-fmtbar-swatches" onMouseDown={guard}>
                {HILITE_COLORS.map((c) => (
                  <button key={c} className="ws-fmtbar-swatch" style={{ background: c }} title={c} onMouseDown={guard} onClick={() => exec('hiliteColor', c)} />
                ))}
              </div>
            )}
          </div>

          <span className="ws-fmtbar-sep" />
          <button className="ws-fmtbar-btn" title={t('editor.clearFormat')} onMouseDown={guard} onClick={() => exec('removeFormat')}><Eraser size={15} /></button>
        </div>
      )}
    </div>
  )
}
