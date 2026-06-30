import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Strikethrough, Info } from 'lucide-react'
import type { Doc } from '../types'
import './BasicEditor.css'

// 打开「不符合 Schema」的野生 HTML 文件时的视图。
// 立场（按 Colin 回炉要求）：文件照常全保真渲染——就像打开任何 .html 一样；只在顶部加一条轻提示
// 说「不符合 Schema、仅基础编辑」，不展开「哪里不符合」的清单。编辑只给基础文字格式（加粗/斜体/
// 下划线/删除线），通过跟完整编辑器同款的浮动格式气泡（复用 .ws-fmtbar 样式）呈现——选中文字才浮出，
// UX 跟正常文档一致，只是没有「转换块 / 颜色 / AI / 斜杠菜单」这些结构化能力。
//
// 渲染走沙箱 iframe（srcDoc + sandbox="allow-same-origin" 无 allow-scripts）：野文件的 <style> 被
// 隔离不污染 app、<script>/onclick 不执行（对齐真 app「不跑文档 JS」），body 设 contentEditable +
// 对 iframe document 跑 execCommand 做基础编辑。

interface Bubble {
  top: number
  left: number
}

const TOOLS: { cmd: string; icon: typeof Bold; label: string }[] = [
  { cmd: 'bold', icon: Bold, label: '加粗' },
  { cmd: 'italic', icon: Italic, label: '斜体' },
  { cmd: 'underline', icon: Underline, label: '下划线' },
  { cmd: 'strikeThrough', icon: Strikethrough, label: '删除线' },
]

export default function BasicEditor({ doc }: { doc: Doc }) {
  const html = doc.rawHtml ?? ''
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)

  useEffect(() => {
    const f = frameRef.current
    const host = hostRef.current
    if (!f || !host) return

    const refresh = () => {
      const d = f.contentDocument
      const sel = d?.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setBubble(null)
        return
      }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (!r || (r.width === 0 && r.height === 0)) {
        setBubble(null)
        return
      }
      const fr = f.getBoundingClientRect()
      const hr = host.getBoundingClientRect()
      const top = fr.top - hr.top + r.top - 42 // 浮在选区上方
      const left = fr.left - hr.left + r.left + r.width / 2
      setBubble({ top: Math.max(6, top), left })
    }

    const wire = () => {
      const d = f.contentDocument
      if (!d || !d.body) return
      d.body.contentEditable = 'true'
      d.body.style.outline = 'none'
      d.body.style.cursor = 'text'
      d.addEventListener('selectionchange', refresh)
      d.addEventListener('mouseup', refresh)
      d.addEventListener('keyup', refresh)
      d.addEventListener('scroll', refresh, true)
      d.addEventListener('blur', () => setTimeout(() => setBubble(null), 120), true)
    }

    f.addEventListener('load', wire)
    if (f.contentDocument?.readyState === 'complete') wire()
    return () => {
      const d = f.contentDocument
      d?.removeEventListener('selectionchange', refresh)
      d?.removeEventListener('mouseup', refresh)
      d?.removeEventListener('keyup', refresh)
      d?.removeEventListener('scroll', refresh, true)
      f.removeEventListener('load', wire)
    }
  }, [html])

  const exec = (cmd: string) => {
    const d = frameRef.current?.contentDocument
    if (!d) return
    try {
      d.execCommand(cmd, false)
    } catch {
      /* execCommand 已废弃但浏览器仍支持 */
    }
  }

  return (
    <div className="nce" ref={hostRef}>
      {/* 轻提示：不符合 Schema → 仅基础编辑（不展开违规细节） */}
      <div className="nce-notice">
        <Info size={15} />
        <span>
          这个文件不符合 Wordspace Schema，<strong>仅支持基础文字编辑</strong>（加粗 / 斜体 / 下划线 / 删除线）。结构化编辑（块、斜杠菜单、AI 排版）对它停用。
        </span>
      </div>

      {/* 全保真渲染（像打开任何 .html 一样） */}
      <div className="nce-stage">
        <iframe
          ref={frameRef}
          className="nce-frame"
          title={doc.title}
          sandbox="allow-same-origin"
          srcDoc={html}
        />
      </div>

      {/* 浮动格式气泡：复用完整编辑器同款 .ws-fmtbar 样式，只保留基础文字格式 */}
      {bubble && (
        <div
          className="ws-fmtbar nce-bubble"
          style={{ top: bubble.top, left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()}
          role="toolbar"
        >
          {TOOLS.map((t) => (
            <button
              key={t.cmd}
              className="ws-fmtbar-btn"
              title={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(t.cmd)}
            >
              <t.icon size={15} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
