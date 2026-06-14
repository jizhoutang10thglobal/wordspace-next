import { useEffect, useRef } from 'react'
import {
  Heading,
  Type,
  List,
  Quote,
  Info,
  Minus,
} from 'lucide-react'
import type { BlockType } from '../../types'

const ITEMS: { type: BlockType; label: string; icon: typeof Type }[] = [
  { type: 'heading', label: '标题', icon: Heading },
  { type: 'text', label: '正文', icon: Type },
  { type: 'list', label: '列表', icon: List },
  { type: 'quote', label: '引用', icon: Quote },
  { type: 'callout', label: '提示', icon: Info },
  { type: 'divider', label: '分隔线', icon: Minus },
]

/**
 * Small popover anchored under a block's "+" handle. Picks a block type to
 * insert after the current block.
 */
export default function BlockAddMenu({
  onPick,
  onClose,
}: {
  onPick: (type: BlockType) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="ws-addmenu" ref={ref} role="menu">
      {ITEMS.map((it) => {
        const Icon = it.icon
        return (
          <button
            key={it.type}
            className="ws-addmenu-item"
            role="menuitem"
            onClick={() => onPick(it.type)}
          >
            <Icon size={15} strokeWidth={1.8} />
            <span>{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}
