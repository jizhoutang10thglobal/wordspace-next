import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlertTriangle,
  Lock,
  ChevronDown,
  ShieldAlert,
} from 'lucide-react'
import type { Doc } from '../types'
import { checkSchema, type Violation } from '../lib/schemaCheck'
import './BasicEditor.css'

// 非合规文件的「降级基础编辑」视图。
// 真 app 用沙箱 iframe 直载文件 → 这里照搬：raw HTML 进 <iframe srcdoc>，sandbox="allow-same-origin"
// 无 allow-scripts —— 样例的花哨 <style> 被隔离（不污染 ui-demo）、<script>/onclick 不执行（对齐
// 真 app「不跑文档 JS」），但父层仍可把 body 设 contentEditable + 对 iframe document 跑 execCommand
// 做基础文字编辑（B/I/U/S）。Schema 的结构编辑（块/斜杠/块菜单/AI 重排）一律不提供，并显式标灰，
// 让对比一眼可见。降级原因来自确定性校验器 checkSchema（同一个，可视化页的实时 widget 也用它）。

// 标灰展示「被禁用的 Schema 工具」——不是真按钮，纯对照说明。
const DISABLED_TOOLS = ['结构块', '斜杠菜单 /', '块菜单', '拖拽重排', 'AI 重排版', '插入块']

function ViolationRow({ v }: { v: Violation }) {
  return (
    <li className={`be-vrow be-sev-${v.severity}`}>
      <span className="be-vdot" />
      <div className="be-vbody">
        <div className="be-vtitle">
          {v.title}
          {v.count > 1 && <span className="be-vcount">×{v.count}</span>}
          <span className="be-vrule">{v.rule}</span>
        </div>
        <div className="be-vdetail">{v.detail}</div>
        {v.sample && <code className="be-vsample">{v.sample}</code>}
      </div>
    </li>
  )
}

export default function BasicEditor({ doc }: { doc: Doc }) {
  const html = doc.rawHtml ?? ''
  const result = useMemo(() => checkSchema(html), [html])
  const blocking = result.violations.filter((v) => v.severity === 'block')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [open, setOpen] = useState(true)

  // iframe 载入后把 body 设为可编辑（基础编辑的载体）。
  useEffect(() => {
    const f = frameRef.current
    if (!f) return
    const wire = () => {
      const d = f.contentDocument
      if (!d || !d.body) return
      d.body.contentEditable = 'true'
      d.body.style.outline = 'none'
      d.body.style.cursor = 'text'
      d.body.style.minHeight = '100%'
    }
    f.addEventListener('load', wire)
    if (f.contentDocument?.readyState === 'complete') wire()
    return () => f.removeEventListener('load', wire)
  }, [html])

  // 对 iframe 文档跑 execCommand（B/I/U/S）。onMouseDown preventDefault 防按钮抢走 iframe 选区。
  const exec = (cmd: string) => {
    const d = frameRef.current?.contentDocument
    if (!d) return
    try {
      d.execCommand(cmd, false)
    } catch {
      /* execCommand 已废弃但浏览器仍支持；失败静默 */
    }
  }

  const TOOLS: { cmd: string; icon: typeof Bold; label: string }[] = [
    { cmd: 'bold', icon: Bold, label: '加粗' },
    { cmd: 'italic', icon: Italic, label: '斜体' },
    { cmd: 'underline', icon: Underline, label: '下划线' },
    { cmd: 'strikeThrough', icon: Strikethrough, label: '删除线' },
  ]

  return (
    <div className="be">
      {/* 降级横幅 */}
      <div className="be-banner">
        <div className="be-banner-head" onClick={() => setOpen((o) => !o)}>
          <AlertTriangle size={17} className="be-banner-ico" />
          <div className="be-banner-text">
            <strong>此文件不符合 Wordspace Schema，已降级为基础编辑。</strong>
            <span className="be-banner-sub">{doc.title} · 确定性校验器判定 {blocking.length} 处不符合</span>
          </div>
          <ChevronDown size={16} className={`be-chev ${open ? 'is-open' : ''}`} />
        </div>
        {open && (
          <ul className="be-vlist">
            {result.violations.map((v) => (
              <ViolationRow key={v.rule} v={v} />
            ))}
          </ul>
        )}
      </div>

      {/* 工具区：基础工具条 + 标灰的 Schema 工具对照 */}
      <div className="be-toolbar">
        <div className="be-tools-basic">
          {TOOLS.map((t) => (
            <button
              key={t.cmd}
              className="be-tbtn"
              title={t.label}
              onMouseDown={(e) => {
                e.preventDefault()
                exec(t.cmd)
              }}
            >
              <t.icon size={16} />
            </button>
          ))}
          <span className="be-tools-tag">基础文字编辑</span>
        </div>
        <div className="be-tools-locked" title="非合规文件不提供结构化编辑">
          <Lock size={13} />
          {DISABLED_TOOLS.map((d) => (
            <span key={d} className="be-locked-chip">
              {d}
            </span>
          ))}
          <span className="be-locked-note">已禁用</span>
        </div>
      </div>

      {/* 隔离渲染：raw HTML 进沙箱 iframe，body 可编辑 */}
      <div className="be-stage">
        <div className="be-paper">
          <iframe
            ref={frameRef}
            className="be-frame"
            title={doc.title}
            sandbox="allow-same-origin"
            srcDoc={html}
          />
        </div>
        <div className="be-foot">
          <ShieldAlert size={13} />
          只保住文字增删改 + 基础样式；该文件的交互逻辑 / 复杂结构在 Schema 范式内无法保留。
        </div>
      </div>
    </div>
  )
}
