export interface SlashItem {
  key: string
  label: string
}

/**
 * 斜杠 `/` 插入菜单：在编辑块里打 `/` 触发，光标处弹出。键盘导航/筛选由 Canvas 管，
 * 这里只负责渲染（fixed 定位在光标下方）。点项与键盘 Enter 走同一个 onPick。
 */
export default function SlashMenu({
  pos,
  items,
  activeIndex,
  onPick,
}: {
  pos: { top: number; left: number }
  items: SlashItem[]
  activeIndex: number
  onPick: (key: string) => void
}) {
  return (
    <div
      className="ws-slashmenu"
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
    >
      {items.length === 0 ? (
        <div className="ws-slashmenu-empty">没有匹配项</div>
      ) : (
        items.map((it, i) => (
          <button
            key={it.key}
            className={`ws-slashmenu-item${i === activeIndex ? ' active' : ''}`}
            role="menuitem"
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(it.key)
            }}
          >
            {it.label}
          </button>
        ))
      )}
    </div>
  )
}
