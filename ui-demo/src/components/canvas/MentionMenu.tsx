import { createPortal } from 'react-dom'
import {
  FileText,
  FilePlus2,
  FileImage,
  FileSpreadsheet,
  Presentation,
  File,
  FileType,
  Globe2,
} from 'lucide-react'
import type { FileKind } from '../../types'

/** @提及菜单条目：一个可链接文件（文档在前、其它文件在后）、「新建」或「网址链接」。 */
export interface MentionItem {
  key: string // 文件条目 = 'f:<path>'；新建 = 'create'；网址 = 'url'
  title: string
  path?: string // 根内路径（新建/网址条目无）
  kind?: FileKind
  create?: boolean
  url?: boolean
}

function KindIcon({ it }: { it: MentionItem }) {
  if (it.create) return <FilePlus2 size={14} />
  if (it.url) return <Globe2 size={14} />
  switch (it.kind) {
    case 'image':
      return <FileImage size={14} />
    case 'sheet':
      return <FileSpreadsheet size={14} />
    case 'slides':
      return <Presentation size={14} />
    case 'word':
    case 'pdf':
      return <FileType size={14} />
    case 'html':
    case 'md':
      return <FileText size={14} />
    default:
      return <File size={14} />
  }
}

/**
 * 文档提及菜单（互链的统一选择器）：四个入口共用——@/[[/【【 手势、斜杠菜单「链接到文档」、
 * 工具栏「链接」按钮（wrap 模式）、以及未来的更多入口。键盘导航/筛选由 Canvas 管，这里只渲染；
 * 点项与 Enter 走同一 onPick。两行条目（标题 + 根内路径）——重名文档靠第二行路径消歧。
 */
export default function MentionMenu({
  pos,
  items,
  activeIndex,
  query,
  onPick,
}: {
  pos: { top: number; left: number }
  items: MentionItem[]
  activeIndex: number
  query: string
  onPick: (key: string) => void
}) {
  // portal 到 body：position:fixed 的坐标是视口系，不能被任何带 transform 的祖先
  // （如路由入场动画容器）劫持包含块（见 global.css .ws-anim-view 的注释）。
  return createPortal(
    <div
      className="ws-mentionmenu"
      role="menu"
      // left 夹在视口内（菜单 max-width 320）——caret 在行尾时菜单不能伸出屏幕
      style={{ position: 'fixed', top: pos.top, left: Math.min(pos.left, window.innerWidth - 336) }}
    >
      <div className="ws-mentionmenu-head">链接到文档{query ? `：“${query}”` : '（输入文字筛选）'}</div>
      {items.length === 0 ? (
        <div className="ws-mentionmenu-empty">没有匹配的文档</div>
      ) : (
        items.map((it, i) => (
          <button
            key={it.key}
            className={`ws-mentionmenu-item${i === activeIndex ? ' active' : ''}${it.create ? ' is-create' : ''}${it.url ? ' is-url' : ''}`}
            role="menuitem"
            onMouseDown={(e) => {
              e.preventDefault() // 别抢走编辑块焦点——插入要用当前 caret
              onPick(it.key)
            }}
          >
            <span className="ws-mentionmenu-ico">
              <KindIcon it={it} />
            </span>
            <span className="ws-mentionmenu-text">
              <span className="ws-mentionmenu-title ws-truncate">{it.title}</span>
              {it.path && <span className="ws-mentionmenu-path ws-truncate">{it.path}</span>}
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  )
}
