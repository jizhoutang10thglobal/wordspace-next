import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CtxItem } from '../lib/webCtxMenu'
import './WebContextMenu.css'

// 网页右键菜单（原生 Wordspace 风格 DOM 菜单，纸方墨圆）。真 app 里是原生 Menu.popup；
// ui-demo 里是 DOM 浮层，演示同一套分节结构与交互。定位在光标处，超出视口边缘时回夹。
export default function WebContextMenu({
  x,
  y,
  items,
  onAction,
  onClose,
}: {
  x: number
  y: number
  items: CtxItem[]
  onAction: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // 夹进视口：菜单右/下缘超出时向左/上翻，别被裁掉。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const nx = x + width > window.innerWidth - 8 ? Math.max(8, window.innerWidth - width - 8) : x
    const ny = y + height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - height - 8) : y
    setPos({ x: nx, y: ny })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return (
    <div ref={ref} className="web-ctx" style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="web-ctx-sep" />
        ) : (
          <button
            key={i}
            className="web-ctx-item"
            disabled={it.enabled === false}
            onClick={() => {
              onAction(it.id)
              onClose()
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
