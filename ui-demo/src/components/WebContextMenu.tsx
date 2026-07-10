import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

  // 定位：默认左上角贴光标（往右下展开）；贴不下就翻转——右缘溢出→右缘贴光标（往左开）、
  // 下缘溢出→下缘贴光标（往上开）。这是标准右键菜单手感，始终紧贴光标。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const nx = x + width > window.innerWidth - 8 ? Math.max(8, x - width) : x
    const ny = y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y
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

  // Portal 到 body：菜单绝不嵌在有 transform 的祖先里（否则 position:fixed 会以祖先为基准 → 偏离光标很远）。
  return createPortal(
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
    </div>,
    document.body,
  )
}
