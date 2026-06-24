import { useState } from 'react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link2,
  Sparkles,
  ChevronDown,
} from 'lucide-react'
import type { BlockType, ListStyle } from '../../types'

export interface FormatRect {
  top: number
  left: number
}

const TURN_INTO: {
  label: string
  type: BlockType
  level?: 1 | 2 | 3
  listStyle?: ListStyle
}[] = [
  { label: '正文', type: 'text' },
  { label: '标题 1', type: 'heading', level: 1 },
  { label: '标题 2', type: 'heading', level: 2 },
  { label: '标题 3', type: 'heading', level: 3 },
  { label: '引用', type: 'quote' },
  { label: '无序列表', type: 'list', listStyle: 'bulleted' },
  { label: '编号列表', type: 'list', listStyle: 'numbered' },
  { label: '待办列表', type: 'list', listStyle: 'todo' },
]
const TEXT_COLORS = ['#1a1a1a', '#b3261e', '#b06000', '#188038', '#1a73e8', '#7b1fa2']
const HILITE_COLORS = ['#fff59d', '#ffd6d6', '#d7f0db', '#dbe9ff', '#f3e3ff']

/**
 * 按需浮出的富工具栏（Notion 气泡式）。选中块时浮在块上方、编辑时浮在文字选区上方。
 * 自己不直接动 DOM：命令通过 onCmd / onTurnInto / onAskAI 交给 Canvas，按「块选中 vs 文字
 * 选中」两种模式分别应用。mousedown 一律 preventDefault，避免点工具栏丢掉选区。
 */
export default function FormatToolbar({
  rect,
  onCmd,
  onTurnInto,
  onAskAI,
}: {
  rect: FormatRect
  onCmd: (command: string, value?: string) => void
  onTurnInto: (type: BlockType, level?: 1 | 2 | 3, listStyle?: ListStyle) => void
  onAskAI: () => void
}) {
  const [menu, setMenu] = useState<'turn' | 'color' | 'hilite' | null>(null)
  const guard = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div
      className="ws-fmtbar"
      style={{ top: rect.top, left: rect.left }}
      onMouseDown={guard}
      onClick={(e) => e.stopPropagation()}
      role="toolbar"
    >
      {/* 转为：块类型切换 */}
      <div className="ws-fmtbar-holder">
        <button
          className="ws-fmtbar-btn ws-fmtbar-text"
          title="转换块类型"
          onMouseDown={guard}
          onClick={() => setMenu(menu === 'turn' ? null : 'turn')}
        >
          转为 <ChevronDown size={12} strokeWidth={2} />
        </button>
        {menu === 'turn' && (
          <div className="ws-fmtbar-menu" onMouseDown={guard}>
            {TURN_INTO.map((it) => (
              <button
                key={it.label}
                className="ws-fmtbar-menu-item"
                onMouseDown={guard}
                onClick={() => {
                  onTurnInto(it.type, it.level, it.listStyle)
                  setMenu(null)
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="ws-fmtbar-sep" />

      <button className="ws-fmtbar-btn" title="加粗" onMouseDown={guard} onClick={() => onCmd('bold')}>
        <Bold size={15} strokeWidth={2} />
      </button>
      <button className="ws-fmtbar-btn" title="斜体" onMouseDown={guard} onClick={() => onCmd('italic')}>
        <Italic size={15} strokeWidth={2} />
      </button>
      <button className="ws-fmtbar-btn" title="下划线" onMouseDown={guard} onClick={() => onCmd('underline')}>
        <Underline size={15} strokeWidth={2} />
      </button>
      <button className="ws-fmtbar-btn" title="删除线" onMouseDown={guard} onClick={() => onCmd('strikeThrough')}>
        <Strikethrough size={15} strokeWidth={2} />
      </button>
      <button className="ws-fmtbar-btn" title="行内代码" onMouseDown={guard} onClick={() => onCmd('__code__')}>
        <Code size={15} strokeWidth={2} />
      </button>

      <span className="ws-fmtbar-sep" />

      {/* 文字颜色 */}
      <div className="ws-fmtbar-holder">
        <button
          className="ws-fmtbar-btn ws-fmtbar-aglyph"
          title="文字颜色"
          onMouseDown={guard}
          onClick={() => setMenu(menu === 'color' ? null : 'color')}
        >
          A
        </button>
        {menu === 'color' && (
          <div className="ws-fmtbar-swatches" onMouseDown={guard}>
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                className="ws-fmtbar-swatch"
                style={{ background: c }}
                title={c}
                onMouseDown={guard}
                onClick={() => {
                  onCmd('foreColor', c)
                  setMenu(null)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 背景高亮 */}
      <div className="ws-fmtbar-holder">
        <button
          className="ws-fmtbar-btn"
          title="背景高亮"
          onMouseDown={guard}
          onClick={() => setMenu(menu === 'hilite' ? null : 'hilite')}
        >
          🖍
        </button>
        {menu === 'hilite' && (
          <div className="ws-fmtbar-swatches" onMouseDown={guard}>
            {HILITE_COLORS.map((c) => (
              <button
                key={c}
                className="ws-fmtbar-swatch"
                style={{ background: c }}
                title={c}
                onMouseDown={guard}
                onClick={() => {
                  onCmd('hiliteColor', c)
                  setMenu(null)
                }}
              />
            ))}
          </div>
        )}
      </div>

      <button className="ws-fmtbar-btn" title="链接" onMouseDown={guard} onClick={() => onCmd('createLink')}>
        <Link2 size={15} strokeWidth={2} />
      </button>

      <span className="ws-fmtbar-sep" />

      <button
        className="ws-fmtbar-btn ws-fmtbar-ai"
        title="让 AI 重排这一块（开发中）"
        onMouseDown={guard}
        onClick={onAskAI}
      >
        <Sparkles size={14} strokeWidth={2} /> AI
      </button>
    </div>
  )
}
