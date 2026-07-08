import { createPortal } from 'react-dom'
import { FileText, FilePlus2 } from 'lucide-react'

/** @提及菜单条目：一个可链接文档（同根内的 .html/.md），或末尾的「新建」。 */
export interface MentionItem {
  key: string // 文件条目 = 'f:<path>'；新建 = 'create'
  title: string
  path?: string // 根内路径（新建条目无）
  create?: boolean
}

/**
 * `@` / `[[` / `【【` 文档提及菜单：光标处弹出，选一篇文档插入互链。
 * 与 SlashMenu 同一交互协议：键盘导航/筛选由 Canvas 管，这里只渲染；点项与 Enter 走同一 onPick。
 * 两行条目（标题 + 根内路径）——重名文档靠第二行路径消歧（Foam/Obsidian 的教训）。
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
      <div className="ws-mentionmenu-head">链接到文档{query ? `：“${query}”` : ''}</div>
      {items.length === 0 ? (
        <div className="ws-mentionmenu-empty">没有匹配的文档</div>
      ) : (
        items.map((it, i) => (
          <button
            key={it.key}
            className={`ws-mentionmenu-item${i === activeIndex ? ' active' : ''}${it.create ? ' is-create' : ''}`}
            role="menuitem"
            onMouseDown={(e) => {
              e.preventDefault() // 别抢走编辑块焦点——插入要用当前 caret
              onPick(it.key)
            }}
          >
            <span className="ws-mentionmenu-ico">
              {it.create ? <FilePlus2 size={14} /> : <FileText size={14} />}
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
